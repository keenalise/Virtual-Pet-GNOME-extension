/* Desktop Dog — a cute, stationary pixel-art puppy for GNOME Shell 46.
 *
 * The dog sits quietly on the desktop. It blinks, wags its tail and breathes
 * on its own, but NEVER walks, jumps or wanders around. It reacts only when
 * you interact with it (click, double-click, drag, right-click, pet, feed…).
 *
 * Architecture, in short:
 *   - A single St.Widget "container" holds an St.Icon (the current pose) plus a
 *     small St.Label used for floating effects (hearts / zzz).
 *   - The container is added to the Shell chrome (Main.layoutManager.addChrome)
 *     so it floats above normal windows. Only the dog's own box is part of the
 *     input region, so clicks elsewhere still reach your windows.
 *   - Poses are separate SVG sprites swapped via St.Icon.gicon. Motion (bounce,
 *     breathing, wiggle) uses Clutter property transitions (actor.ease).
 *   - All timers, transitions and signals are tracked and torn down in disable().
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const DRAG_THRESHOLD = 6;        // px of movement before a press becomes a drag
const DOUBLE_CLICK_MS = 260;     // single-click reaction waits this long for a 2nd click
const MARGIN = 24;               // gap from the work-area edge for default placement

class DogManager {
    constructor(extension) {
        this._ext = extension;
        this._settings = extension.getSettings();
        this._path = extension.path;

        this._gicons = {};         // pose name -> Gio.FileIcon (cached)
        this._timeouts = new Set();
        this._settingsIds = [];
        this._state = 'idle';      // idle | happy | playing | eating | petted | sleeping
        this._onStage = false;

        this._idleTimer = 0;
        this._transientTimer = 0;
        this._singleClickTimer = 0;
        this._sleepZTimer = 0;
        this._grab = null;
        this._dragEventId = 0;
        this._drag = null;
        this._soundCtx = undefined;
    }

    // ---- lifecycle -------------------------------------------------------

    build() {
        const size = this._size();

        this._icon = new St.Icon({
            gicon: this._gicon('dog-idle'),
            icon_size: size,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._icon.set_pivot_point(0.5, 1.0); // scale/rotate from the feet

        this._fx = new St.Label({
            style_class: 'desktop-dog-fx',
            text: '',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
            x_expand: true,
        });
        this._fx.set_pivot_point(0.5, 0.5);
        this._fx.visible = false;

        this._container = new St.Widget({
            reactive: true,
            track_hover: true,
            style_class: 'desktop-dog',
            layout_manager: new Clutter.BinLayout(),
        });
        this._container.set_size(size, size);
        this._container.add_child(this._icon);
        this._container.add_child(this._fx);

        this._pressId = this._container.connect('button-press-event',
            this._onPress.bind(this));

        this._createMenu();

        // place the dog
        let x = this._settings.get_int('pos-x');
        let y = this._settings.get_int('pos-y');
        if (x < 0 || y < 0)
            [x, y] = this._defaultPosition();
        [x, y] = this._clamp(x, y);
        this._container.set_position(x, y);

        this._setVisible(this._settings.get_boolean('show-dog'));

        // react to live settings changes
        const watch = (key, fn) =>
            this._settingsIds.push(this._settings.connect(`changed::${key}`, fn));
        watch('dog-size', () => this._applySize());
        watch('show-dog', () => this._setVisible(this._settings.get_boolean('show-dog')));
        watch('enable-animations', () => this._applyAnimationSettings());
        watch('idle-breathing', () => this._applyAnimationSettings());
        watch('animation-frequency', () => this._applyAnimationSettings());
        watch('reset-position', () => {
            if (this._settings.get_boolean('reset-position')) {
                this._resetPosition();
                this._settings.set_boolean('reset-position', false);
            }
        });

        this._monitorsId = Main.layoutManager.connect('monitors-changed',
            () => this._onMonitorsChanged());

        // initial state
        if (this._settings.get_boolean('is-sleeping'))
            this._enterSleep(false);
        else
            this._rest();
    }

    destroy() {
        // timers
        this._clearIdleTimer();
        this._cancelTransient();
        this._stopSleepZ();
        if (this._singleClickTimer) {
            GLib.Source.remove(this._singleClickTimer);
            this._singleClickTimer = 0;
        }
        for (const id of this._timeouts)
            GLib.Source.remove(id);
        this._timeouts.clear();

        // drag / grab
        this._endDrag();

        // signals
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];
        if (this._monitorsId) {
            Main.layoutManager.disconnect(this._monitorsId);
            this._monitorsId = 0;
        }
        if (this._pressId && this._container) {
            this._container.disconnect(this._pressId);
            this._pressId = 0;
        }

        // menu
        if (this._menu) {
            this._menu.destroy();
            this._menu = null;
        }
        this._menuManager = null;

        // actors
        if (this._container) {
            this._container.remove_all_transitions();
            if (this._icon)
                this._icon.remove_all_transitions();
            if (this._onStage) {
                Main.layoutManager.removeChrome(this._container);
                this._onStage = false;
            }
            this._container.destroy();
            this._container = null;
        }
        this._icon = null;
        this._fx = null;
        this._soundCtx = undefined;
        this._settings = null;
    }

    // ---- assets & helpers ------------------------------------------------

    _gicon(pose) {
        if (!this._gicons[pose]) {
            const file = Gio.File.new_for_path(
                GLib.build_filenamev([this._path, 'assets', `${pose}.svg`]));
            this._gicons[pose] = new Gio.FileIcon({file});
        }
        return this._gicons[pose];
    }

    _setIcon(pose) {
        if (this._icon)
            this._icon.gicon = this._gicon(pose);
    }

    _size() {
        return this._settings.get_int('dog-size');
    }

    _animationsOn() {
        return this._settings.get_boolean('enable-animations');
    }

    _addTimeout(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeouts.delete(id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
        return id;
    }

    // ---- positioning -----------------------------------------------------

    _workArea(x, y) {
        const size = this._size();
        const cx = x + size / 2, cy = y + size / 2;
        let mon = Main.layoutManager.monitors.find(m =>
            cx >= m.x && cx < m.x + m.width && cy >= m.y && cy < m.y + m.height);
        if (!mon)
            mon = Main.layoutManager.primaryMonitor;
        return Main.layoutManager.getWorkAreaForMonitor(mon.index);
    }

    _defaultPosition() {
        const size = this._size();
        const idx = Main.layoutManager.primaryIndex;
        const wa = Main.layoutManager.getWorkAreaForMonitor(idx);
        const corner = this._settings.get_string('initial-position');
        let x, y;
        switch (corner) {
        case 'bottom-left':
            x = wa.x + MARGIN; y = wa.y + wa.height - size - MARGIN; break;
        case 'top-right':
            x = wa.x + wa.width - size - MARGIN; y = wa.y + MARGIN; break;
        case 'top-left':
            x = wa.x + MARGIN; y = wa.y + MARGIN; break;
        case 'center':
            x = wa.x + (wa.width - size) / 2; y = wa.y + (wa.height - size) / 2; break;
        case 'bottom-right':
        default:
            x = wa.x + wa.width - size - MARGIN; y = wa.y + wa.height - size - MARGIN; break;
        }
        return [Math.round(x), Math.round(y)];
    }

    _clamp(x, y) {
        const size = this._size();
        const wa = this._workArea(x, y);
        const nx = Math.max(wa.x, Math.min(wa.x + wa.width - size, x));
        const ny = Math.max(wa.y, Math.min(wa.y + wa.height - size, y));
        return [Math.round(nx), Math.round(ny)];
    }

    _savePosition() {
        if (!this._container)
            return;
        this._settings.set_int('pos-x', this._container.x);
        this._settings.set_int('pos-y', this._container.y);
    }

    _resetPosition() {
        const [x, y] = this._defaultPosition();
        this._settings.set_int('pos-x', x);
        this._settings.set_int('pos-y', y);
        if (this._container)
            this._container.set_position(x, y);
    }

    _onMonitorsChanged() {
        if (!this._container)
            return;
        const [x, y] = this._clamp(this._container.x, this._container.y);
        this._container.set_position(x, y);
    }

    _applySize() {
        if (!this._container)
            return;
        const size = this._size();
        this._icon.icon_size = size;
        this._container.set_size(size, size);
        const [x, y] = this._clamp(this._container.x, this._container.y);
        this._container.set_position(x, y);
    }

    _setVisible(show) {
        if (!this._container)
            return;
        if (show) {
            if (!this._onStage) {
                Main.layoutManager.addChrome(this._container, {
                    affectsInputRegion: true,
                    affectsStruts: false,
                    trackFullscreen: true,
                });
                this._onStage = true;
                const [x, y] = this._clamp(this._container.x, this._container.y);
                this._container.set_position(x, y);
            }
            this._container.show();
            this._applyAnimationSettings();
        } else {
            this._clearIdleTimer();
            this._stopBreathing();
            this._container.hide();
        }
    }

    // ---- animation plumbing ---------------------------------------------

    _applyAnimationSettings() {
        if (!this._container || !this._container.visible)
            return;
        this._startBreathing();
        if (this._state === 'idle')
            this._scheduleIdle();
        else
            this._clearIdleTimer();
        if (!this._animationsOn()) {
            this._clearIdleTimer();
            this._stopBreathing();
        }
    }

    _startBreathing() {
        if (!this._icon)
            return;
        this._stopBreathing();
        if (!this._container || !this._container.visible)
            return;
        if (!this._animationsOn() || !this._settings.get_boolean('idle-breathing'))
            return;
        if (this._state !== 'idle' && this._state !== 'sleeping')
            return;
        const slow = this._state === 'sleeping';
        this._icon.set_pivot_point(0.5, 1.0);
        this._icon.ease_property('scale-y', slow ? 1.05 : 1.03, {
            duration: slow ? 3200 : 2200,
            mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            repeatCount: -1,
            autoReverse: true,
        });
    }

    _stopBreathing() {
        if (!this._icon)
            return;
        this._icon.remove_transition('scale-y');
        this._icon.scale_y = 1;
    }

    _resetIconTransforms() {
        if (!this._icon)
            return;
        this._icon.remove_all_transitions();
        this._icon.scale_y = 1;
        this._icon.translation_y = 0;
        this._icon.rotation_angle_z = 0;
    }

    // ---- idle behaviour --------------------------------------------------

    _clearIdleTimer() {
        if (this._idleTimer) {
            GLib.Source.remove(this._idleTimer);
            this._idleTimer = 0;
        }
    }

    _scheduleIdle() {
        this._clearIdleTimer();
        if (!this._animationsOn() || this._state !== 'idle' ||
            !this._container || !this._container.visible)
            return;
        const freq = this._settings.get_int('animation-frequency'); // 0..100
        const minMs = 2600, maxMs = 15000;
        const t = 1 - freq / 100;                       // 0 = often, 1 = rare
        let interval = minMs + (maxMs - minMs) * t;
        interval *= 0.7 + Math.random() * 0.6;          // jitter
        this._idleTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE,
            Math.round(interval), () => {
                this._idleTimer = 0;
                this._doIdleAction();
                this._scheduleIdle();
                return GLib.SOURCE_REMOVE;
            });
    }

    _doIdleAction() {
        if (this._state !== 'idle')
            return;
        if (Math.random() < 0.6)
            this._blink();
        else
            this._wagTail(2);
    }

    _blink() {
        if (this._state !== 'idle')
            return;
        this._setIcon('dog-blink');
        this._addTimeout(150, () => {
            if (this._state === 'idle')
                this._setIcon('dog-idle');
        });
    }

    _wagTail(times = 3) {
        if (this._state !== 'idle')
            return;
        let i = 0;
        const step = () => {
            if (this._state !== 'idle') {
                this._setIcon('dog-idle');
                return;
            }
            this._setIcon(i % 2 === 0 ? 'dog-wag' : 'dog-idle');
            i += 1;
            if (i <= times * 2)
                this._addTimeout(180, step);
            else
                this._setIcon('dog-idle');
        };
        step();
    }

    // ---- state transitions ----------------------------------------------

    _rest() {
        this._cancelTransient();
        this._resetIconTransforms();
        if (this._settings.get_boolean('is-sleeping')) {
            this._state = 'sleeping';
            this._setIcon('dog-sleep');
            this._startBreathing();
            this._startSleepZ();
        } else {
            this._state = 'idle';
            this._setIcon('dog-idle');
            this._startBreathing();
            this._scheduleIdle();
        }
    }

    _cancelTransient() {
        if (this._transientTimer) {
            GLib.Source.remove(this._transientTimer);
            this._timeouts.delete(this._transientTimer);
            this._transientTimer = 0;
        }
    }

    _enterTransient(state, pose, duration) {
        this._cancelTransient();
        this._clearIdleTimer();
        this._stopSleepZ();
        this._stopBreathing();
        this._resetIconTransforms();
        this._state = state;
        this._setIcon(pose);
        this._transientTimer = this._addTimeout(duration, () => {
            this._transientTimer = 0;
            this._rest();
        });
    }

    _enterSleep(playEffect = true) {
        this._settings.set_boolean('is-sleeping', true);
        this._cancelTransient();
        this._clearIdleTimer();
        this._resetIconTransforms();
        this._state = 'sleeping';
        this._setIcon('dog-sleep');
        this._startBreathing();
        this._startSleepZ();
        if (playEffect)
            this._popEffect('z');
        this._updateMenuLabels();
    }

    _wake() {
        this._stopSleepZ();
        if (this._settings.get_boolean('is-sleeping'))
            this._settings.set_boolean('is-sleeping', false);
        if (this._state === 'sleeping') {
            this._resetIconTransforms();
            this._state = 'idle';
            this._setIcon('dog-idle');
            this._startBreathing();
            this._scheduleIdle();
        }
        this._updateMenuLabels();
    }

    _toggleSleep() {
        if (this._settings.get_boolean('is-sleeping'))
            this._wake();
        else
            this._enterSleep(true);
    }

    _startSleepZ() {
        this._stopSleepZ();
        this._sleepZTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 2800, () => {
            if (this._state !== 'sleeping') {
                this._sleepZTimer = 0;
                return GLib.SOURCE_REMOVE;
            }
            if (this._animationsOn())
                this._popEffect('z');
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopSleepZ() {
        if (this._sleepZTimer) {
            GLib.Source.remove(this._sleepZTimer);
            this._sleepZTimer = 0;
        }
    }

    // ---- reactions -------------------------------------------------------

    _reactHappy() {
        this._wake();
        this._enterTransient('happy', 'dog-happy', 1400);
        this._bounce();
        this._popEffect('♥');  // heart
        this._playSound();
    }

    _reactPlay() {
        if (this._singleClickTimer) {
            GLib.Source.remove(this._singleClickTimer);
            this._timeouts.delete(this._singleClickTimer);
            this._singleClickTimer = 0;
        }
        this._wake();
        this._enterTransient('playing', 'dog-playing', 2200);
        this._hopTwice();
        this._popEffect('★');  // star (widely available glyph)
        this._playSound();
    }

    _reactFeed() {
        this._wake();
        this._enterTransient('eating', 'dog-eating', 2600);
        this._nod(4);
        this._playSound();
    }

    _reactPet() {
        this._wake();
        this._enterTransient('petted', 'dog-petted', 1900);
        this._wiggle(4);
        this._popEffect('♥');  // heart
        this._playSound();
    }

    _bounce() {
        if (!this._animationsOn() || !this._icon)
            return;
        const up = -Math.round(this._size() * 0.12);
        this._icon.ease({
            translation_y: up,
            duration: 170,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (!this._icon)
                    return;
                this._icon.ease({
                    translation_y: 0,
                    duration: 260,
                    mode: Clutter.AnimationMode.EASE_OUT_BOUNCE,
                });
            },
        });
    }

    _hopTwice() {
        if (!this._animationsOn() || !this._icon)
            return;
        const up = -Math.round(this._size() * 0.16);
        const hop = next => {
            if (!this._icon || this._state !== 'playing')
                return;
            this._icon.ease({
                translation_y: up,
                duration: 160,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (!this._icon)
                        return;
                    this._icon.ease({
                        translation_y: 0,
                        duration: 220,
                        mode: Clutter.AnimationMode.EASE_OUT_BOUNCE,
                        onComplete: next || null,
                    });
                },
            });
        };
        hop(() => hop(null));
    }

    _nod(times) {
        if (!this._animationsOn() || !this._icon)
            return;
        const down = Math.round(this._size() * 0.05);
        let i = 0;
        const step = () => {
            if (!this._icon || this._state !== 'eating')
                return;
            this._icon.ease({
                translation_y: i % 2 === 0 ? down : 0,
                duration: 220,
                mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                onComplete: () => {
                    i += 1;
                    if (i <= times)
                        step();
                },
            });
        };
        step();
    }

    _wiggle(times) {
        if (!this._animationsOn() || !this._icon)
            return;
        this._icon.set_pivot_point(0.5, 1.0);
        let i = 0;
        const step = () => {
            if (!this._icon || this._state !== 'petted') {
                if (this._icon)
                    this._icon.rotation_angle_z = 0;
                return;
            }
            this._icon.ease({
                rotation_angle_z: i % 2 === 0 ? 6 : -6,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                onComplete: () => {
                    i += 1;
                    if (i <= times) {
                        step();
                    } else if (this._icon) {
                        this._icon.ease({rotation_angle_z: 0, duration: 120});
                    }
                },
            });
        };
        step();
    }

    _popEffect(text) {
        if (!this._fx || !this._animationsOn())
            return;
        if (!this._container || !this._container.visible)
            return;
        const size = this._size();
        this._fx.remove_all_transitions();
        this._fx.text = text;
        this._fx.opacity = 0;
        this._fx.scale_x = 0.6;
        this._fx.scale_y = 0.6;
        this._fx.translation_y = Math.round(-size * 0.1);
        this._fx.visible = true;
        this._fx.ease({
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            translation_y: Math.round(-size * 0.42),
            duration: 320,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
            onComplete: () => {
                if (!this._fx)
                    return;
                this._fx.ease({
                    opacity: 0,
                    translation_y: Math.round(-size * 0.72),
                    duration: 620,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    onComplete: () => {
                        if (this._fx)
                            this._fx.visible = false;
                    },
                });
            },
        });
    }

    // ---- sound (optional, lazy, degrades to silence) ---------------------

    _playSound() {
        if (!this._settings.get_boolean('enable-sound'))
            return;
        if (this._soundCtx === undefined) {
            // first use: try to create a GSound context asynchronously
            this._soundCtx = null;
            import('gi://GSound')
                .then(mod => {
                    try {
                        const ctx = new mod.default.Context();
                        ctx.init(null);
                        this._soundCtx = ctx;
                    } catch (_e) {
                        this._soundCtx = null;
                    }
                })
                .catch(() => {});
            return;
        }
        if (this._soundCtx) {
            try {
                this._soundCtx.play_simple({'event.id': 'bell'}, null);
            } catch (_e) {
                // ignore playback errors
            }
        }
    }

    // ---- context menu ----------------------------------------------------

    _createMenu() {
        this._menu = new PopupMenu.PopupMenu(this._container, 0.5, St.Side.TOP);
        this._menu.actor.add_style_class_name('desktop-dog-menu');
        this._menuManager = new PopupMenu.PopupMenuManager(this._container);
        this._menuManager.addMenu(this._menu);
        Main.uiGroup.add_child(this._menu.actor);
        this._menu.actor.hide();

        this._menu.addAction(_('🐾  Pet the dog'), () => this._reactPet());
        this._menu.addAction(_('🍖  Feed the dog'), () => this._reactFeed());
        this._menu.addAction(_('🎾  Play'), () => this._reactPlay());
        this._sleepItem = this._menu.addAction(_('😴  Sleep'), () => this._toggleSleep());

        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._soundItem = new PopupMenu.PopupSwitchMenuItem(
            _('🔊  Sound'), this._settings.get_boolean('enable-sound'));
        this._soundItem.connect('toggled', (_item, state) =>
            this._settings.set_boolean('enable-sound', state));
        this._menu.addMenuItem(this._soundItem);
        this._settingsIds.push(this._settings.connect('changed::enable-sound',
            () => this._soundItem.setToggleState(
                this._settings.get_boolean('enable-sound'))));

        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._menu.addAction(_('📍  Reset position'), () => this._resetPosition());
        this._menu.addAction(_('🙈  Hide dog'), () =>
            this._settings.set_boolean('show-dog', false));
        this._menu.addAction(_('⚙️  Preferences'), () => this._ext.openPreferences());

        this._updateMenuLabels();
    }

    _updateMenuLabels() {
        if (!this._sleepItem)
            return;
        const sleeping = this._settings.get_boolean('is-sleeping');
        this._sleepItem.label.text = sleeping ? _('🌞  Wake up') : _('😴  Sleep');
    }

    // ---- pointer input ---------------------------------------------------

    _onPress(actor, event) {
        const button = event.get_button();

        if (button === 3) {                 // right-click -> context menu
            this._updateMenuLabels();
            this._menu.open(BoxPointer.PopupAnimation.FULL);
            return Clutter.EVENT_STOP;
        }

        if (button === 1) {                 // left -> click or drag
            if (this._menu.isOpen)
                this._menu.close();
            const [sx, sy] = event.get_coords();
            this._drag = {
                sx, sy,
                ox: this._container.x,
                oy: this._container.y,
                moved: false,
                click: event.get_click_count(),
            };
            this._grab = global.stage.grab(this._container);
            this._dragEventId = this._container.connect('event',
                this._onDragEvent.bind(this));
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _onDragEvent(actor, event) {
        if (!this._drag)
            return Clutter.EVENT_PROPAGATE;
        const type = event.type();

        if (type === Clutter.EventType.MOTION) {
            const [x, y] = event.get_coords();
            const dx = x - this._drag.sx;
            const dy = y - this._drag.sy;
            if (!this._drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
                this._drag.moved = true;
                this._cancelTransient();
                this._clearIdleTimer();
                this._stopSleepZ();
                this._stopBreathing();
                this._resetIconTransforms();
                // a little "picked up" look (don't wake a sleeping dog)
                this._setIcon(this._settings.get_boolean('is-sleeping')
                    ? 'dog-sleep' : 'dog-happy');
            }
            if (this._drag.moved) {
                const [nx, ny] = this._clamp(this._drag.ox + dx, this._drag.oy + dy);
                this._container.set_position(nx, ny);
            }
            return Clutter.EVENT_STOP;
        }

        if (type === Clutter.EventType.BUTTON_RELEASE) {
            const {moved, click} = this._drag;
            this._endDrag();
            if (moved) {
                this._savePosition();
                this._rest();
            } else {
                this._onClick(click);
            }
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _endDrag() {
        if (this._dragEventId && this._container) {
            this._container.disconnect(this._dragEventId);
            this._dragEventId = 0;
        }
        if (this._grab) {
            this._grab.dismiss();
            this._grab = null;
        }
        this._drag = null;
    }

    _onClick(clickCount) {
        if (clickCount >= 2) {
            this._reactPlay();
            return;
        }
        if (this._singleClickTimer) {
            GLib.Source.remove(this._singleClickTimer);
            this._timeouts.delete(this._singleClickTimer);
        }
        this._singleClickTimer = this._addTimeout(DOUBLE_CLICK_MS, () => {
            this._singleClickTimer = 0;
            this._reactHappy();
        });
    }
}

export default class DesktopDogExtension extends Extension {
    enable() {
        this._dog = new DogManager(this);
        this._dog.build();
    }

    disable() {
        if (this._dog) {
            this._dog.destroy();
            this._dog = null;
        }
    }
}
