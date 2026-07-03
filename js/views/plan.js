"use strict";

import html from './html/plan.html';
import Utils from './modules/utils.js';
import WarpModal from './modules/modal.js';
import {WarpSeatFactory,WarpSeat,EVERYONE_KEY} from './modules/seat.js';
import { OfficeMap } from './modules/officeMap.js';
import PlanUserData from './modules/planuserdata.js';
import BookAs from './modules/bookas.js';
import { WarpCalendar } from './modules/calendarGrid.js';
import { M } from '../app/materialize.js';
import warpDialog from '../app/dialog.js';
import { buildDataTable } from '../lib/dataTable.js';

import noUiSlider from 'nouislider';
import "./css/plan/nouislider.css";

// Pristine pid-scoped URL templates (still carrying __PID__) captured ONCE at
// module load. plan.js used to mutate window.warpGlobals.URLs[...] in place on
// every mount — but String.replace only substitutes the placeholder the FIRST
// time, so navigating /plan/1 -> /plan/2 left planGetSeat/planImage/… pinned to
// plan 1 and the second plan view rendered plan 1's seats + map (and planModify,
// which reads URLs['planImage'], inherited the wrong image too). Substituting
// from these pristine copies every mount makes every plan navigation correct.
const PRISTINE_URLS = {
    planGetSeat:  window.warpGlobals.URLs['planGetSeat'],
    planImage:    window.warpGlobals.URLs['planImage'],
    planAutoBook: window.warpGlobals.URLs['planAutoBook'],
    planGetUsers: window.warpGlobals.URLs['planGetUsers'],
};

export { html };

export async function mount(ctx) {
    const root = ctx.root;
    const pid = ctx.params.pid;

    // Per-plan context (calendarGrid, darkFilter, today, planTimezone,
    // defaultSelectedDates, planPreviewPrefs, isZoneAdmin, isZoneViewer) is
    // fetched fresh on every mount — a long-lived SPA session crossing
    // midnight must not show yesterday's grid (PLAN_SPA_REFACTOR.md §7). A
    // 403/404 here propagates out of mount() and router.js renders the
    // client #view-error state (the SPA's replacement for the old
    // server-side 403 on this deep link).
    const contextResp = await Utils.xhr.get(
        window.warpGlobals.URLs['planGetContext'].replace('__PID__', pid),
        { toastOnSuccess: false, errorOnFailure: false });
    const context = contextResp.response;

    // These modules (seat.js, calendarGrid.js, planuserdata.js) read plan
    // context off window.warpGlobals directly, unchanged from the old
    // server-rendered-inline-script world — so plan.js seeds it here instead
    // of threading ctx through every layer.
    window.warpGlobals.pid = pid;
    window.warpGlobals.darkFilter = context.darkFilter;
    window.warpGlobals.calendarGrid = context.calendarGrid;
    window.warpGlobals.defaultSelectedDates = context.defaultSelectedDates;
    window.warpGlobals.today = context.today;
    window.warpGlobals.planTimezone = context.planTimezone;
    window.warpGlobals.planPreviewPrefs = context.planPreviewPrefs;
    window.warpGlobals.isZoneAdmin = context.isZoneAdmin;
    window.warpGlobals.isZoneViewer = context.isZoneViewer;
    // daysInAdvance (used by the seat-edit "days in advance" select, admin-only)
    // is already shell-global — set once in WP1's spaGlobals, not per-plan.

    // pid-scoped XHR URLs: spaURLs renders once at shell boot with __PID__
    // placeholders. Substitute from the pristine captures above into per-mount
    // locals (and, for planGetUsers, back into the global planuserdata.js reads)
    // — never into the global URL table itself, so the placeholder survives for
    // the next plan mount and for planModify's own read of URLs['planImage'].
    const planGetSeatURL  = PRISTINE_URLS.planGetSeat.replace('__PID__', pid);
    const planImageURL    = PRISTINE_URLS.planImage.replace('__PID__', pid);
    const planAutoBookURL = PRISTINE_URLS.planAutoBook.replace('__PID__', pid);
    window.warpGlobals.URLs['planGetUsers'] = PRISTINE_URLS.planGetUsers.replace('__PID__', pid);

    // Jinja conditionals ({% if isZoneAdmin %} / {% if not isZoneViewer %})
    // become conditional DOM removal from context data.
    root.querySelectorAll('[data-requires]').forEach(function(el) {
        var req = el.dataset.requires;
        var keep = (req === 'zoneAdmin' && context.isZoneAdmin) ||
                   (req === 'notZoneViewer' && !context.isZoneViewer);
        if (!keep) el.remove();
    });

    var calendar = null;   // this mount's WarpCalendar instance (view-local — was module-level in the pre-SPA version, a re-mount leak risk)
    var om = null;         // this mount's OfficeMap instance
    var themeObserver = null;

    function downloadSeatData(seatFactory) {

        var url = planGetSeatURL;

        var login = seatFactory.getLogin();
        if (login !== window.warpGlobals.login)
            url += (url.indexOf('?') === -1 ? '?' : '&') + "login=" + login;

        Utils.xhr.get(url, {toastOnSuccess:false})
        .then( function(v) {

            seatFactory.setSeatsData(v.response);
            seatFactory.updateAllStates( getSelectedDates());

        })
    }

    function getSelectedDates() {
        if (!calendar)
            return [];
        var slider = root.querySelector('#timeslider');
        var times = slider.noUiSlider.get(true);

        // if next day 00:00, move it one second back
        if (times[1] == 24*3600)
            times[1] = 24*3600-1;

        var fromOff = parseInt(times[0]);
        var toOff = parseInt(times[1]);
        var res = [];
        for (var ts of calendar.getSelected()) {
            res.push({
                fromTS: ts + fromOff,
                toTS: ts + toOff
            });
        }
        return res;
    }

    // Seconds-of-day <-> "HH:MM" (pure arithmetic — R1: no new Date(ts).
    // getTimezoneOffset/toISOString would silently re-anchor to the browser TZ.)
    function fmtTime(secs) {
        secs = Math.round(secs);
        if (secs >= 24*3600) secs = 24*3600 - 1;   // display clamp: 24:00 -> 23:59
        if (secs < 0) secs = 0;
        var h = Math.floor(secs / 3600);
        var m = Math.floor((secs % 3600) / 60);
        return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    }

    function parseTime(str) {
        var m = /^\s*(\d{1,2})[:.](\d{1,2})\s*$/.exec(String(str));
        if (!m) return null;
        var h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
        var mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
        return h*3600 + mm*60;
    }

    // Snap a seconds-of-day value to the slider's 15-min step. Start rounds DOWN
    // (the user always gets at least their requested start), end rounds UP (the
    // user always gets at least their requested end). Guarantees the booked slot
    // always contains thespan the user typed.
    function snapToStep(secs, direction) {
        var step = 15*60;
        if (direction === 'down') return Math.floor(secs / step) * step;
        return Math.ceil(secs / step) * step;
    }

    function initSlider() {

        var slider = root.querySelector('#timeslider');
        noUiSlider.create(slider, {
            start: window.warpGlobals['defaultSelectedDates'].slider,    //this later on can be anyway overwritten from session storage
            connect: true,
            behaviour: 'drag',
            step: 15*60,
            margin: 15*60,
            orientation: 'horizontal',
            range: { min: +window.warpGlobals.bookOpen, max: +window.warpGlobals.bookClose }
        });

        var minInput = root.querySelector('#timeslider-min');
        var maxInput = root.querySelector('#timeslider-max');

        // Slider -> inputs: format the two handles into the edit boxes.
        slider.noUiSlider.on('update', function(values, handle, unencoded) {
            minInput.value = fmtTime(unencoded[0]);
            maxInput.value = fmtTime(unencoded[1]);
        });

        // Inputs -> slider: parse HH:MM, snap to the 15-min step (start down, end
        // up so the booked slot always contains the span typed), clamp to the rail
        // range, keep start < end with the slider's margin. Invalid input reverts
        // to the current handle value (the update handler repopulates the box).
        function applyFromInputs() {
            var lo = parseTime(minInput.value);
            var hi = parseTime(maxInput.value);
            if (lo === null || hi === null) {
                slider.noUiSlider.set(slider.noUiSlider.get(true));   // revert
                return;
            }
            var min = +window.warpGlobals.bookOpen, max = +window.warpGlobals.bookClose;
            lo = snapToStep(lo, 'down');
            hi = snapToStep(hi, 'up');
            lo = Math.min(max, Math.max(min, lo));
            hi = Math.min(max, Math.max(min, hi));
            if (hi - lo < 15*60) hi = Math.min(max, lo + 15*60);   // honour the margin
            slider.noUiSlider.set([lo, hi]);
        }
        minInput.addEventListener('change', applyFromInputs, {signal: ctx.signal});
        maxInput.addEventListener('change', applyFromInputs, {signal: ctx.signal});

        return slider;
    }

    function getAssignedLabelUsers(seat) {
        var assignments = seat.getAssignments();
        var users = [];
        for (var key in assignments) {
            var a = assignments[key];
            if (a.isEveryone) continue;
            if (a.days_in_advance !== null) continue;
            users.push(a.name);
        }
        return users;
    }

    // Label content for a seat, KISS: a title (seat name) + a flat list of names
    // (booked users, or assigned users when there's no booking preview). One style
    // for booked vs assigned — the icon differs, the label body is just names.
    function labelContent(seat, prefs) {
        var showSeatNames = prefs.show_seat_names;
        var showBookingPreview = prefs.show_booking_preview;
        var showAssignedNames = prefs.show_assigned_names;

        var bookings = showBookingPreview ? seat.getBookings() : [];
        var names = [];
        if (showBookingPreview && bookings.length) {
            var seen = new Set();
            for (var b of bookings) {
                if (seen.has(b.username)) continue;
                seen.add(b.username);
                names.push(b.username);
            }
        } else if (showAssignedNames) {
            names = getAssignedLabelUsers(seat);
        }

        return {
            title: showSeatNames ? seat.getName() : null,
            names: names,                                   // [] when nothing to show
        };
    }

    // Flat label body: one div per name. A single name that overflows the 72px label
    // box is later split into two rows at the last whitespace (see
    // wrapLongSingleNameLabels); each row keeps nowrap+ellipsis, so either row is
    // still cut with "…" if it alone doesn't fit.
    function buildLabelBody(names) {
        var f = document.createDocumentFragment();
        for (var n of names) {
            var d = document.createElement("div");
            d.className = "seat_label_name";
            d.textContent = n;
            f.appendChild(d);
        }
        return f;
    }

    // After OfficeMap paints, a single-name label whose name overflows the label box
    // (would show "…") is split into two rows at the last whitespace: row1 =
    // everything before the last word, row2 = the last word. Both rows keep the
    // nowrap+ellipsis `.seat_label_name` style, so each is cut with "…" if it alone
    // still doesn't fit. Multi-name labels (one div per name) are left as-is.
    // Runs in a rAF scheduled after OfficeMap's paint rAF, so the body is in the DOM
    // and measurable. Re-runs on every create/update: a content-signature change
    // rebuilds the body to a single div, which this re-splits; unchanged sigs leave
    // the already-split two-div body intact (skipped via the child-count guard).
    // Two passes (measure all, then mutate all) so the scrollWidth reads don't
    // interleave with replaceChildren writes — avoids layout thrash on large maps.
    function wrapLongSingleNameLabels() {
        var bodies = root.querySelectorAll('#planmap .OMLabelBody');
        var pending = [];                                     // pass 1: measure only (no writes)
        for (var body of bodies) {
            if (body.children.length !== 1) continue;        // multi-name or already split
            var nameEl = body.children[0];
            if (!nameEl.classList.contains('seat_label_name')) continue;
            if (nameEl.scrollWidth <= nameEl.clientWidth) continue;   // fits, no split
            var text = nameEl.textContent;
            var m = /\s\S*$/.exec(text);                       // last whitespace + trailing word
            if (!m) continue;                                  // no whitespace -> can't split
            pending.push({ body: body, text: text, m: m });
        }
        for (var p of pending) {                              // pass 2: mutate (no reads)
            var row1 = p.text.slice(0, p.m.index);             // everything before the last word
            var row2 = p.m[0].slice(p.m[0].search(/\S/));      // last word (drop the whitespace)
            p.body.replaceChildren();
            for (var t of [row1, row2]) {
                if (t === '') continue;
                var d = document.createElement('div');
                d.className = 'seat_label_name';
                d.textContent = t;
                p.body.appendChild(d);
            }
        }
    }

    // Hover/long-press hint body (lazy — built only when shown): the detailed
    // assignment + bookings preview. No suppression: any seat with assignments or
    // bookings gets a hint (so assigned seats show their assignment details).
    function buildHintNode(seat) {
        var div = document.createElement("div");
        div.className = 'seat_preview';

        var title = div.appendChild(document.createElement("div"));
        title.innerText = TR("Seat %{seat_name}", {seat_name: seat.getName()});
        title.className = "seat_preview_title";

        var allAssignments = Object.values(seat.getAssignments());
        var visibleAssignments = allAssignments.filter(a => !a.isEveryone);
        var everyoneAssignment = allAssignments.find(a => a.isEveryone);

        if (visibleAssignments.length) {
            var header = div.appendChild(document.createElement("span"));
            header.appendChild(document.createTextNode(TR("Assigned to:")));
            header.className = "seat_preview_header";
            var table = div.appendChild(document.createElement("table"));
            for (let a of visibleAssignments) {
                var tr = table.appendChild(document.createElement("tr"));
                tr.appendChild(document.createElement("td")).appendChild(document.createTextNode(a.name));
                var diaText = a.days_in_advance !== null ? "(" + a.days_in_advance + "d)" : "";
                tr.appendChild(document.createElement("td")).appendChild(document.createTextNode(diaText));
            }
        }

        if (everyoneAssignment) {
            var evHeader = div.appendChild(document.createElement("span"));
            var diaText = everyoneAssignment.days_in_advance !== null
                ? TR("Available to everyone (up to %{n}d in advance)", {n: everyoneAssignment.days_in_advance})
                : TR("Available to everyone");
            evHeader.appendChild(document.createTextNode(diaText));
            evHeader.className = "seat_preview_header";
        }

        var bookings = seat.getBookings();
        if (bookings.length) {
            var header = div.appendChild(document.createElement("span"));
            header.appendChild(document.createTextNode(TR("Bookings:")));
            header.className = "seat_preview_header";
            var table = div.appendChild(document.createElement("table"));
            var maxToShow = 8;
            for (var i = 0; i < bookings.length; ++i) {
                var tr = table.appendChild(document.createElement("tr"));
                if (i === maxToShow) {                 // more than maxToShow → "…" row, stop
                    tr.appendChild(document.createElement("td")).innerText = "...";
                    break;
                }
                var b = bookings[i];
                tr.appendChild(document.createElement("td")).innerText = b.datetime1;
                tr.appendChild(document.createElement("td")).innerText = b.datetime2;
                tr.appendChild(document.createElement("td")).innerText = b.username;
            }
        }

        return div;
    }

    function buildAllSeatData(seatFactory, prefs) {
        var seats = [];
        for (var sid in seatFactory.instances) {
            var seat = seatFactory.instances[sid];
            if (seat.isOtherZone()) continue;
            var c = labelContent(seat, prefs);
            seats.push({
                id: sid,
                x: seat.x, y: seat.y,
                sprite: seat.sprite,
                labelTitle: c.title,
                labelBody: c.names.length ? buildLabelBody(c.names) : null,
                hintable: true,
            });
        }
        return seats;
    }

    // Build the OfficeMap component on #planmap and wire it to the seat factory.
    function initOfficeMap(seatFactory) {

        var prefs = window.warpGlobals['planPreviewPrefs'] || {};
        var labelSigs = {};   // sid -> label content signature (diff to skip rebuilds)

        // Touch devices get the "clamp" sprite mode below; fine-pointer devices get
        // plain follow (seats scale 1:1 with the map).
        var coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

        var m = new OfficeMap(root.querySelector('#planmap'), {
            mapImage: planImageURL,
            sprite: { url: window.warpGlobals.URLs['seatSprite'], cellWidth: WarpSeat.Sprites.spriteSize, cellHeight: WarpSeat.Sprites.spriteSize },
            zoom: { initial: 'fit', min: null, max: 4 },
            spriteZoom: coarse ? { min: 0, max: 1 } : undefined,
            filter: null,                                    // dark filter applied dynamically via setFilter below
            hintBuilder: function(sid) {
                var seat = seatFactory.instances[sid];
                return seat ? buildHintNode(seat) : null;
            },
        });

        seatFactory.on('setSeatsData', function() {           // this === factory
            labelSigs = {};
            m.createSeats(buildAllSeatData(this, prefs));
            requestAnimationFrame(wrapLongSingleNameLabels);
        });

        seatFactory.on('updateAllStates', function() {        // this === factory
            for (var sid in this.instances) {
                var seat = this.instances[sid];
                if (seat.isOtherZone()) continue;
                var c = labelContent(seat, prefs);
                var sig = (c.title != null ? c.title : '\x00') + '\x01' + c.names.join('\x02');
                var partial = { sprite: seat.sprite, hintable: true };
                if (sig !== labelSigs[sid]) {
                    partial.labelTitle = c.title;
                    partial.labelBody = c.names.length ? buildLabelBody(c.names) : null;
                    labelSigs[sid] = sig;
                }
                m.updateSeat(sid, partial);
            }
            requestAnimationFrame(wrapLongSingleNameLabels);
        });

        m.addEventListener('click', function(e) {
            var seat = seatFactory.instances[e.detail.id];
            if (seat) seatFactory._fire('click', seat);
        });

        // Prefs changed (show seat names / booking preview / assigned names): force
        // a rebuild of every seat's label by resetting the signatures + re-running.
        document.addEventListener('warp:prefsSaved', function(e) {
            var newPrefs = e.detail && e.detail.planPreviewPrefs;
            if (!newPrefs) return;
            prefs.show_seat_names = !!newPrefs.show_seat_names;
            prefs.show_booking_preview = !!newPrefs.show_booking_preview;
            prefs.show_assigned_names = !!newPrefs.show_assigned_names;
            labelSigs = {};
            seatFactory.updateAllStates();   // reuses current selectedDates; fires updateAllStates listener
        }, {signal: ctx.signal});

        return m;
    }

    function initActionMenu(seatFactory) {

        if (window.warpGlobals.isZoneViewer)
            return;

        var seat = null;    // used for passing seat to btn click events (closure)
        var assignedData = [];

        // Snapshot of the seat's enabled flag and assignment list at modal-open
        // time, so Save only sends the parts that actually changed (avoids
        // spurious conflict warnings on an unchanged assign/disable payload).
        var seatEditOriginalEnabled = null;
        var seatEditOriginalSig = null;

        function assignmentsSignature(data) {
            return JSON.stringify(data.map(function (d) {
                return { login: d.login, days_in_advance: d.days_in_advance };
            }).sort(function (a, b) {
                return String(a.login).localeCompare(String(b.login));
            }));
        }

        function initSeatEditModal(seatArg) {

            var assignModalEl = root.querySelector("#seat_edit_modal");
            if (!assignModalEl || typeof(PlanUserData) === 'undefined')
                return null;

            var assignModal = warpDialog.getInstance(assignModalEl);
            if (!assignModal)
                assignModal = warpDialog(assignModalEl, {
                    // Ephemeral edit: clear any leftover typed-but-not-selected
                    // text when the modal closes so a reopen starts clean.
                    onCloseEnd: function () {
                        var addInput = root.querySelector('#assigned_seat_add_input');
                        if (addInput) addInput.value = '';
                    }
                });

            // Seat-enabled toggle: seed from the live seat state.
            var enabledCheckbox = root.querySelector('#seat_edit_enabled');
            if (enabledCheckbox) {
                enabledCheckbox.checked = !!seatArg.enabled;
                seatEditOriginalEnabled = !!seatArg.enabled;
            }

            var zoneUserData = PlanUserData.getInstance();
            var userData = zoneUserData.getData();
            var maxDays = window.warpGlobals.daysInAdvance;

            // Reset list from current seat's assignments
            assignedData.length = 0;
            var assignments = seatArg.getAssignments();
            for (let [key, a] of Object.entries(assignments))
                assignedData.push({ login: key === EVERYONE_KEY ? null : key, name: a.name, days_in_advance: a.days_in_advance });
            seatEditOriginalSig = assignmentsSignature(assignedData);

            function buildDaysSelect(current) {
                var sel = document.createElement('select');
                sel.className = 'browser-default assigned_seat_days_select';

                var todayOpt = document.createElement('option');
                todayOpt.value = '0';
                todayOpt.textContent = "0 (" + TR("Same day") + ")";
                sel.appendChild(todayOpt);

                for (var d = 1; d < maxDays; d++) {
                    var opt = document.createElement('option');
                    opt.value = String(d);
                    opt.textContent = String(d);
                    sel.appendChild(opt);
                }

                var unlOpt = document.createElement('option');
                unlOpt.value = '';
                unlOpt.textContent = String(maxDays) + " (" + TR("Unlimited") + ")";
                sel.appendChild(unlOpt);

                sel.value = (current !== null && current !== undefined) ? String(current) : '';
                return sel;
            }

            function renderList() {
                var ul = root.querySelector('#assigned_seat_list');
                ul.innerHTML = '';
                for (let item of assignedData) {
                    var li = document.createElement('li');
                    li.className = 'collection-item assigned_seat_row';

                    var nameSpan = document.createElement('span');
                    if (item.login === null) {
                        var icon = document.createElement('i');
                        icon.className = 'material-icons small';
                        icon.textContent = 'public';
                        icon.style.verticalAlign = 'middle';
                        icon.style.marginRight = '4px';
                        nameSpan.appendChild(icon);
                        nameSpan.appendChild(document.createTextNode(item.name));
                    } else {
                        nameSpan.textContent = item.name;
                    }

                    var sel = buildDaysSelect(item.days_in_advance);
                    sel.addEventListener('change', function() {
                        var entry = assignedData.find(d => d.login === item.login);
                        if (entry) entry.days_in_advance = this.value ? parseInt(this.value) : null;
                    });

                    var delBtn = document.createElement('a');
                    delBtn.href = '#!';
                    delBtn.className = 'btn-flat assigned_seat_delete_btn';
                    delBtn.innerHTML = '<i class="material-icons small warp-icon-danger">delete</i>';
                    delBtn.addEventListener('click', function(e) {
                        e.preventDefault();
                        var idx = assignedData.findIndex(d => d.login === item.login);
                        if (idx !== -1) assignedData.splice(idx, 1);
                        renderList();
                        assignModal.markDirty();
                    });

                    var right = document.createElement('span');
                    right.className = 'assigned_seat_controls';
                    right.appendChild(sel);
                    right.appendChild(delBtn);

                    li.appendChild(nameSpan);
                    li.appendChild(right);
                    ul.appendChild(li);
                }
            }

            // Re-initialize autocomplete (destroy previous instance to avoid stale data)
            var addInputEl = root.querySelector('#assigned_seat_add_input');
            var acInstance = M.Autocomplete.getInstance(addInputEl);
            if (acInstance) acInstance.destroy();
            addInputEl.value = '';
            M.updateTextFields();

            var everyoneStr = TR('Everyone');
            var autocompleteData = {};
            autocompleteData[everyoneStr] = null;
            for (let login in userData)
                autocompleteData[ PlanUserData.makeUserStr(login, userData[login]) ] = null;

            M.Autocomplete.init(addInputEl, {
                data: autocompleteData,
                dropdownOptions: { constrainWidth: false, container: addInputEl.closest('dialog') || root },
                minLength: 2,
                limit: 10,
                onAutocomplete: function(selectedText) {
                    if (selectedText === everyoneStr) {
                        if (assignedData.some(d => d.login === null)) {
                            M.toast({ text: TR("User already assigned") });
                            addInputEl.value = '';
                            return;
                        }
                        assignedData.push({ login: null, name: everyoneStr, days_in_advance: null });
                        renderList();
                        assignModal.markDirty();
                        addInputEl.value = '';
                        addInputEl.focus();
                        return;
                    }
                    var login = zoneUserData.makeUserStrRev(selectedText);
                    if (!login) {
                        M.toast({ text: TR("Unknown user") });
                        addInputEl.value = '';
                        return;
                    }
                    if (assignedData.some(d => d.login === login)) {
                        M.toast({ text: TR("User already assigned") });
                        addInputEl.value = '';
                        return;
                    }
                    assignedData.push({ login: login, name: userData[login], days_in_advance: null });
                    renderList();
                    assignModal.markDirty();
                    addInputEl.value = '';
                    addInputEl.focus();
                }
            });

            renderList();
            return assignModal;
        }

        // init modal
        var actionEl = root.querySelector('#action_modal');
        var actionModal =  warpDialog(actionEl);

        // register hooks
        var actionBtns = root.getElementsByClassName('plan_action_btn');

        seatFactory.on( 'click', function() {

            var state = this.getState();

            if (state == WarpSeat.SeatStates.NOT_AVAILABLE || state == WarpSeat.SeatStates.VIEW_ONLY || state == WarpSeat.SeatStates.VIEW_ONLY_TAKEN)
                return;

            var actions = [];
            var bookMsg = false;
            var removeMsg = false;

            switch (state) {
                case WarpSeat.SeatStates.CAN_BOOK:
                    actions.push('book');
                    bookMsg = true;
                    break;
                case WarpSeat.SeatStates.CAN_CHANGE:
                    actions.push('delete');
                    // no break here
                case WarpSeat.SeatStates.CAN_REBOOK:
                    actions.push('update');
                    bookMsg = removeMsg = true;
                    break;
                case WarpSeat.SeatStates.CAN_DELETE:
                case WarpSeat.SeatStates.CAN_DELETE_EXACT:
                    actions.push('delete');
                    removeMsg = true;
                    break;
            };

            if (window.warpGlobals.isZoneAdmin) {
                actions.push('seat-edit');
                actions.push('seat-edit-save');
            }

            if (!actions.length)
                return;

            let msg1El = root.querySelector("#action_modal_msg1");
            msg1El.innerHTML = "";

            if (bookMsg) {

                var bookDatesTable = document.createElement("table");
                for (let d of getSelectedDates()) {
                    let f = WarpSeatFactory._formatDatePair(d);
                    let tr = bookDatesTable.appendChild(document.createElement("tr"));
                    tr.appendChild( document.createElement("td")).innerText = f.datetime1;
                    tr.appendChild( document.createElement("td")).innerText = f.datetime2;
                }

                let p = document.createElement('P');
                p.innerText = TR("Seat %{seat_name} to be booked:",{seat_name:this.getName()});

                msg1El.appendChild(p);
                msg1El.appendChild(bookDatesTable);
            }

            let msg2El = root.querySelector("#action_modal_msg2");
            msg2El.innerHTML = "";

            if (removeMsg) {

                var myConflictsTable = document.createElement("table");
                for (let c of seatFactory.getMyConflictingBookings(this)) {
                    let tr = myConflictsTable.appendChild(document.createElement("tr"));
                    tr.appendChild( document.createElement("td")).innerText = c.zone_name
                    tr.appendChild( document.createElement("td")).innerText = c.seat_name;
                    tr.appendChild( document.createElement("td")).innerText = c.datetime1;
                    tr.appendChild( document.createElement("td")).innerText = c.datetime2;
                }

                let p = document.createElement('P');
                p.innerText = TR("To be released:");

                msg2El.appendChild(p);
                msg2El.appendChild(myConflictsTable);
            }

            for (let btn of actionBtns) {
                btn.classList.toggle('active', actions.includes(btn.dataset.action));
            }

            seat = this;
            actionModal.open();
        });

        var actionBtnClicked = function(e) {

            // This is not a real action, it should just show the edit modal.
            // The real apply button is inside the modal (seat-edit-save).
            if (this.dataset.action == 'seat-edit') {
                var editModal = initSeatEditModal(seat);
                if (editModal)
                    editModal.open();
                return;
            }

            var applyData = {};

            if (this.dataset.action == "seat-edit-save" && typeof(PlanUserData) !== 'undefined') {
                // Only send the parts that actually changed since the modal opened,
                // so an unchanged Save doesn't fire spurious conflict warnings.
                if (assignmentsSignature(assignedData) !== seatEditOriginalSig) {
                    applyData['assign'] = {
                        sid: seat.getSid(),
                        logins: assignedData.map(d => ({
                            login: d.login,
                            days_in_advance: d.days_in_advance
                        }))
                    };
                }
                var enabledCheckbox = root.querySelector('#seat_edit_enabled');
                if (enabledCheckbox && !!enabledCheckbox.checked !== seatEditOriginalEnabled) {
                    applyData[enabledCheckbox.checked ? 'enable' : 'disable'] = [ seat.getSid() ];
                }
            }

            if (this.dataset.action == 'book' || this.dataset.action == 'update') {
                applyData['book'] = {
                    sid: seat.getSid(),
                    dates: getSelectedDates()
                }

                if (window.warpGlobals.isZoneAdmin) {
                    let login = BookAs.getInstance().getSelectedLogin(true);
                    if (login !== null)
                        applyData['book']['login'] = login;
                }
            }

            if (this.dataset.action == 'delete' || this.dataset.action == 'update') {
                applyData['remove'] = seatFactory.getMyConflictingBookings(seat, true);
            }

            // seat-edit-save with no net changes (toggle flipped back, assignments
            // unchanged) builds an empty payload the backend would reject (400).
            // Nothing to apply — just close (modal-close already handled that).
            if (Object.keys(applyData).length === 0)
                return;

            Utils.xhr.post(
                window.warpGlobals.URLs['planApply'],
                applyData,
                {toastOnSuccess: false})
            .then( (value) => {

                var container = document.createElement('div');

                function appendConflictSection(introText, conflicts) {
                    if (!conflicts) return;
                    if (container.children.length)
                        container.appendChild(document.createElement('br'));
                    var intro = container.appendChild(document.createElement('div'));
                    intro.innerHTML = introText;
                    var rows = conflicts.map(function(r) {
                        let dateStr = WarpSeatFactory._formatDatePair(r);
                        return [r.username, dateStr.datetime1, dateStr.datetime2];
                    });
                    container.appendChild(buildDataTable(rows));
                }

                appendConflictSection(
                    TR("Seat is successfully disabled.<br>However there are existing reservations in the the next few weeks. " +
                       "Existing reservations are not automatically released, it has to be done manually."),
                    value.response.conflicts_in_disable);

                appendConflictSection(
                    TR("Seat is successfully assigned.<br>However there are non-assignees' existing reservations in the the next few weeks. " +
                       "Existing reservations are not automatically released, it has to be done manually."),
                    value.response.conflicts_in_assign);

                appendConflictSection(
                    TR("Some reservations are outside the new booking window and must be released manually."),
                    value.response.conflicts_in_window);

                if (!container.children.length)
                    M.toast({text: TR('Action successfull.')});
                else
                    WarpModal.getInstance().open(TR("Warning"), container.outerHTML);

                downloadSeatData(seatFactory);
            }).catch( (value) => {
                downloadSeatData(seatFactory);
            });

        };

        for (let btn of actionBtns)
            btn.addEventListener('click',actionBtnClicked, {signal: ctx.signal})

        return actionModal;
    }

    // preserves states across pages
    //
    // Schema (planSelections): { dates:[ts...], slider:[lo,hi] }
    // R4 migration: the old { cb:[ts...], slider:[...] } shape (and the now-removed
    // { mode, dates, slider } shape) coerce on read — `cb`/`dates` carries the
    // selected days, and WarpCalendar silently drops any ts that's no longer a
    // selectable day (window moved, omitted weekdays changed). A stale/partial
    // blob never crashes.
    function loadPlanSelections() {
        var dflt = window.warpGlobals['defaultSelectedDates'];
        var dfltDates = Array.isArray(dflt.cb) ? dflt.cb : [];
        var dfltSlider = dflt.slider;

        var raw;
        try { raw = window.sessionStorage.getItem('planSelections'); }
        catch (e) { return { dates: dfltDates, slider: dfltSlider }; }

        if (!raw) return { dates: dfltDates, slider: dfltSlider };

        var p;
        try { p = JSON.parse(raw); }
        catch (e) { return { dates: dfltDates, slider: dfltSlider }; }

        var dates = Array.isArray(p.dates) ? p.dates
                  : (Array.isArray(p.cb) ? p.cb : dfltDates);   // migrate old {cb,slider}
        var slider = Array.isArray(p.slider) ? p.slider : dfltSlider;
        return { dates: dates, slider: slider };
    }

    function savePlanSelections(s) {
        try { window.sessionStorage.setItem('planSelections', JSON.stringify(s)); }
        catch (e) { /* sessionStorage quota/disabled — degrade silently */ }
    }

    function initZoneHelp() {

        var helpModalEl = root.querySelector('#planmap_help_modal');
        var helpModal = warpDialog(helpModalEl);

        // Help-modal semantic entry -> #cell-<name> (PLAN §3). Cells bake their own
        // colours from the :root theme vars, so no seat-icon host class is needed.
        var helpSpriteMap = {
            book:           'available',
            rebook:         'rebook',
            conflict:       'taken',
            viewOnly:       'unavailable',
            viewOnlyTaken:  'taken',
            userExact:      'yours',
            userRebook:     'yoursChange',
            userConflict:   'taken',
            bookAssigned:   'availableAssigned',
            rebookAssigned: 'rebookAssigned',
            disabled:       'unavailable',
            assigned:       'assigned'
        };

        var helpModalSpriteDivs = root.getElementsByClassName("help_modal_sprite");
        for (let d of helpModalSpriteDivs) {
            d.style.width = WarpSeat.Sprites.spriteSize + "px";
            d.style.height = WarpSeat.Sprites.spriteSize + "px";

            var cell = helpSpriteMap[d.dataset.sprite];
            if (!cell) continue;

            d.className = "help_modal_sprite";
            d.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48"><use href="' +
                          window.warpGlobals.URLs['seatSprite'] + '#cell-' + cell +
                          '"></use></svg>';
        }

        var helpDiv = root.getElementsByClassName("planmap_help");
        for (let d of helpDiv) {
            d.addEventListener('click', function() { helpModal.open(); }, {signal: ctx.signal})
        }
    }

    // The side panel is an inline column on desktop (default open) and a
    // slide-in overlay on mobile (default closed). Toggled via a data-state
    // attribute (CSS maps it to display:none on desktop, transform on mobile) — no
    // Materialize Sidenav/overlay, which was greying the whole page on reopen.
    function initZoneSidepanel() {

        var el = root.querySelector('#plan_sidepanel');
        var mobile = window.matchMedia('(max-width: 993px)').matches;
        el.setAttribute('data-state', mobile ? 'closed' : 'open');

        var closeBtn = root.querySelector('.plan_sidepanel_close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                el.setAttribute('data-state', 'closed');
            }, {signal: ctx.signal});
        }
        var trig = root.querySelector('.planmap_datetime_trigger');
        if (trig) {
            trig.addEventListener('click', function() {
                el.setAttribute('data-state', 'open');
            }, {signal: ctx.signal});
        }
    }

    function initBookAs(seatFactory) {

        BookAs.getInstance().on('change', function(newLogin) {

            // Full refresh under the new acting login. downloadSeatData adds
            // ?login= when newLogin differs from our own, so the server returns a
            // self-consistent view: accessible seats (admin's access, target's
            // bookable) plus the target's conflict bookings in inaccessible
            // same-group zones. A partial onlyOtherZone update is unsafe — it could
            // return a booking in an *accessible* same-group zone and overwrite that
            // seat's live instance with a div-less ghost.
            seatFactory.setLogin(newLogin);
            downloadSeatData(seatFactory);
        })

    }

    function initAutoBook(seatFactory) {

        if (window.warpGlobals.isZoneViewer)
            return;

        var fabBtn = root.querySelector('#auto_book_btn');
        if (!fabBtn)
            return;

        fabBtn.title = TR("Find me a seat");

        function updateFabState() {
            var noDates = getSelectedDates().length === 0;
            var noChange = !noDates && seatFactory.isExactMatch();
            fabBtn.classList.toggle('disabled', noDates || noChange);
        }

        var slider = root.querySelector('#timeslider');
        slider.noUiSlider.on('update', updateFabState);

        seatFactory.on('updateAllStates', updateFabState);

        fabBtn.addEventListener('click', function() {
            var dates = getSelectedDates();
            if (!dates.length)
                return;

            var payload = { dates: dates };
            if (window.warpGlobals.isZoneAdmin) {
                let login = BookAs.getInstance().getSelectedLogin(true);
                if (login !== null)
                    payload['login'] = login;
            }

            Utils.xhr.post(
                planAutoBookURL,
                payload,
                { toastOnSuccess: false, toastOnError: true })
            .then(function(v) {
                showAutoBookResult(v.response);
                downloadSeatData(seatFactory);
            }).catch(function() {
                downloadSeatData(seatFactory);
            });
        }, {signal: ctx.signal});

        updateFabState();
    }

    function showAutoBookResult(resp) {

        var booked = resp.booked || [];
        var unbookable = resp.unbookable || [];
        var notExtended = resp.not_extended || [];

        var container = document.createElement('div');

        function appendSection(headerText, rowBuilder, items) {
            if (!items.length)
                return;

            if (container.children.length)
                container.appendChild(document.createElement('br'));

            var header = container.appendChild(document.createElement('b'));
            header.innerText = headerText;

            container.appendChild(buildDataTable(items.map(rowBuilder)));
        }

        appendSection(TR("Booked:"), function(b) {
            let f = WarpSeatFactory._formatDatePair(b);
            return [b.seat_name, f.datetime1, f.datetime2];
        }, booked);

        appendSection(TR("Could not extend or rebook:"), function(u) {
            let f = WarpSeatFactory._formatDatePair(u);
            return [f.datetime1, f.datetime2];
        }, notExtended);

        appendSection(TR("Could not book the following dates:"), function(u) {
            let f = WarpSeatFactory._formatDatePair(u);
            let timeCell = document.createDocumentFragment();
            timeCell.appendChild(document.createTextNode(f.datetime2));
            if (u.future_options && u.future_options.length) {
                for (let o of u.future_options) {
                    let dateStr = new Date(o.available_from_ts * 1000).toISOString().substring(0, 10);
                    timeCell.appendChild(document.createElement('br'));
                    timeCell.appendChild(document.createTextNode(
                        TR("Seat %{seat_name} becomes available on %{date}",
                            {seat_name: o.seat_name, date: dateStr})));
                }
            }
            return [f.datetime1, timeCell];
        }, unbookable);

        if (!container.children.length) {
            container.appendChild(document.createTextNode(TR("No seat could be booked.")));
        }

        WarpModal.getInstance().open(TR("Auto book"), container.outerHTML);
    }

    // ---- mount body (was DOMContentLoaded) ----

    var slider = initSlider();
    // Restore persisted selection (migration from the old {cb,slider} shape —
    // R4). Applied BEFORE the calendar is composed so it sees stored defaults.
    var persisted = loadPlanSelections();
    slider.noUiSlider.set(persisted.slider);

    var seatFactory = new WarpSeatFactory(window.warpGlobals.login);

    om = initOfficeMap(seatFactory);
    initActionMenu(seatFactory);

    // Date/time changes recompute every seat's state + sprite + label/hint.
    var updateSeatsView = function() {
        seatFactory.updateAllStates(getSelectedDates());
    };
    slider.noUiSlider.on('update', updateSeatsView);
    slider.noUiSlider.on('update', function() {
        // Persist slider moves with the current calendar selection.
        if (calendar)
            savePlanSelections({ dates: calendar.getSelected(),
                                 slider: slider.noUiSlider.get(true) });
    });

    // Calendar grid: render the backend blob, manage selection. R1/R9: the
    // module does zero date math and stores day identity as integer
    // timestamps taken verbatim from the backend cell ts's. Initial selection
    // comes from the session, the backend default, or migration.
    calendar = new WarpCalendar(
        root.querySelector('#plan_calendar_grid'),
        {
            grid: window.warpGlobals.calendarGrid,
            weekdaysShort: window.warpGlobals.i18n.weekdaysShort,
            monthsShort: window.warpGlobals.i18n.datePicker.i18n_object.monthsShort,
            selected: persisted.dates,
            fallback: window.warpGlobals['defaultSelectedDates'].cb,   // backend default day (grid.defaultTs) — used when persisted dates clamp to empty
            onChange: function(selectedTs) {
                savePlanSelections({ dates: selectedTs,
                                     slider: slider.noUiSlider.get(true) });
                updateSeatsView();
            }
        });

    if (window.warpGlobals.darkFilter) {
        // Coerce each stored value to a number within its valid range, so a legacy or
        // hand-edited DB row can never produce an invalid (or hostile) filter string.
        var clampFilter = function(v, dflt, max) {
            var n = Number(v);
            if (!isFinite(n)) n = dflt;
            return Math.min(max, Math.max(0, n));
        };
        var applyPlanMapFilter = function() {
            var isDark = document.documentElement.getAttribute('theme') === 'dark';
            var f = window.warpGlobals.darkFilter;
            var parts = isDark ? [
                'invert(' + clampFilter(f.invert, 0, 100) + '%)',
                'grayscale(' + clampFilter(f.grayscale, 0, 100) + '%)',
                'sepia(' + clampFilter(f.sepia, 0, 100) + '%)',
                'saturate(' + clampFilter(f.saturate, 100, 200) + '%)',
                'hue-rotate(' + clampFilter(f.hue, 0, 360) + 'deg)',
                'brightness(' + clampFilter(f.brightness, 100, 200) + '%)',
                'contrast(' + clampFilter(f.contrast, 100, 200) + '%)'
            ] : [];
            om.setFilter(parts.join(' ') || null);
        };
        applyPlanMapFilter();
        // Disconnected in unmount() — it closes over `om`, which is destroyed on
        // navigation; a leaked observer would keep firing setFilter() on a dead
        // OfficeMap on every subsequent theme toggle.
        themeObserver = new MutationObserver(applyPlanMapFilter);
        themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['theme']
        });
    }

    initZoneHelp();
    initZoneSidepanel();

    downloadSeatData(seatFactory);

    initAutoBook(seatFactory);

    if (window.warpGlobals.isZoneAdmin) {
        PlanUserData.init();
        initBookAs(seatFactory);
    }

    return function unmount() {
        if (om) om.destroy();
        if (themeObserver) themeObserver.disconnect();
        // noUiSlider attaches its drag listeners to the slider element (inside
        // #view-root, so they die with the DOM) but keeps a strong ref to the
        // instance from the element — destroy() clears that so a re-mount gets a
        // clean instance instead of a 'already has noUiSlider' error.
        if (slider && slider.noUiSlider) slider.noUiSlider.destroy();
        // Both are app-wide module singletons (getInstance()) that guard
        // against double-init — a re-mount (this plan again, or a different
        // one) must clear their state or PlanUserData.init()/initBookAs()
        // throw "already initialized" instead of loading fresh data.
        if (PlanUserData.instance) PlanUserData.instance.reset();
        if (BookAs.instance) BookAs.instance.reset();
    };
}

export default { html, mount };
