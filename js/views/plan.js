"use strict";

import Utils from './modules/utils.js';
import WarpModal from './modules/modal.js';
import {WarpSeatFactory,WarpSeat,EVERYONE_KEY} from './modules/seat.js';
import { OfficeMap } from './modules/officeMap.js';
import PlanUserData from './modules/planuserdata.js';
import BookAs from './modules/bookas.js';
import { WarpCalendar } from './modules/calendarGrid.js';

import noUiSlider from 'nouislider';
import "./css/plan/nouislider.css";

// The warning modal is rendered via innerHTML (WarpModal.open), so any
// user-controlled text (usernames) interpolated into that HTML must be escaped.
// The booking calendar (WarpCalendar) instance for this plan view. Holds the
// selected-day set as integers from the backend grid's cell timestamps; see
// getSelectedDates(). R1: no JS date math, no new Date(ts).
var calendar = null;

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
        return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
}

function downloadSeatData(seatFactory) {

    var url = window.warpGlobals.URLs['getSeat'];

    var login = seatFactory.getLogin();
    if (login !== window.warpGlobals.login)
        url += "?login=" + login;

    Utils.xhr.get(url, {toastOnSuccess:false})
    .then( function(v) {

        seatFactory.setSeatsData(v.response);
        seatFactory.updateAllStates( getSelectedDates());

    })
}

function getSelectedDates() {
    if (!calendar)
        return [];
    var slider = document.getElementById('timeslider');
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

    var slider = document.getElementById('timeslider');
    noUiSlider.create(slider, {
        start: window.warpGlobals['defaultSelectedDates'].slider,    //this later on can be anyway overwritten from session storage
        connect: true,
        behaviour: 'drag',
        step: 15*60,
        margin: 15*60,
        orientation: 'horizontal',
        range: { min: +slider.dataset.min, max: +slider.dataset.max }
    });

    var minInput = document.getElementById('timeslider-min');
    var maxInput = document.getElementById('timeslider-max');

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
        var min = +slider.dataset.min, max = +slider.dataset.max;
        lo = snapToStep(lo, 'down');
        hi = snapToStep(hi, 'up');
        lo = Math.min(max, Math.max(min, lo));
        hi = Math.min(max, Math.max(min, hi));
        if (hi - lo < 15*60) hi = Math.min(max, lo + 15*60);   // honour the margin
        slider.noUiSlider.set([lo, hi]);
    }
    minInput.addEventListener('change', applyFromInputs);
    maxInput.addEventListener('change', applyFromInputs);

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

// Flat label body: one div per name (each wraps to up to 2 rows so a first +
// surname is less likely to be cut). Returned as a fragment.
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
// setSeatsData -> full seat-set sync (createSeats); updateAllStates -> per-seat
// sprite/hintable always, label only when its content signature changed (so a
// slider drag updates icons instantly without rebuilding unchanged labels).
// Hints are built lazily on hover (hintBuilder), never on the hot path.
function initOfficeMap(seatFactory) {

    var prefs = window.warpGlobals['planPreviewPrefs'] || {};
    var labelSigs = {};   // sid -> label content signature (diff to skip rebuilds)

    // Touch devices get the "clamp" sprite mode below; fine-pointer devices get
    // plain follow (seats scale 1:1 with the map).
    var coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

    var om = new OfficeMap(document.getElementById('planmap'), {
        mapImage: window.warpGlobals.URLs['planImage'],
        sprite: { url: window.warpGlobals.URLs['seatSprite'], cellWidth: WarpSeat.Sprites.spriteSize, cellHeight: WarpSeat.Sprites.spriteSize },
        zoom: { initial: 'fit', min: null, max: 4 },
        // Mobile only: from the 1:1 default, zooming IN keeps seats at 48px (they
        // don't grow), zooming OUT lets them shrink with the map (more map visible).
        // max = 1 is the default scale; min = 0 so they follow the map all the way
        // down. Desktop (no spriteZoom) = follow: seats scale 1:1 with the map.
        spriteZoom: coarse ? { min: 0, max: 1 } : undefined,
        filter: null,                                    // dark filter applied dynamically via setFilter below
        hintBuilder: function(sid) {
            var seat = seatFactory.instances[sid];
            return seat ? buildHintNode(seat) : null;
        },
    });

    seatFactory.on('setSeatsData', function() {           // this === factory
        labelSigs = {};
        om.createSeats(buildAllSeatData(this, prefs));
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
            om.updateSeat(sid, partial);
        }
    });

    om.addEventListener('click', function(e) {
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
    });

    return om;
}

function initActionMenu(seatFactory) {

    if (window.warpGlobals.isZoneViewer)
        return;

    var seat = null;    // used for passing seat to btn click events (closure)
    var assignedData = [];

    function initAssignedSeatsModal(seatArg) {

        var assignModalEl = document.getElementById("assigned_seat_modal");
        if (!assignModalEl || typeof(PlanUserData) === 'undefined')
            return null;

        var assignModal = warpDialog.getInstance(assignModalEl);
        if (!assignModal)
            assignModal = warpDialog(assignModalEl, {});

        var zoneUserData = PlanUserData.getInstance();
        var userData = zoneUserData.getData();
        var maxDays = window.warpGlobals.daysInAdvance;

        // Reset list from current seat's assignments
        assignedData.length = 0;
        var assignments = seatArg.getAssignments();
        for (let [key, a] of Object.entries(assignments))
            assignedData.push({ login: key === EVERYONE_KEY ? null : key, name: a.name, days_in_advance: a.days_in_advance });

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
            var ul = document.getElementById('assigned_seat_list');
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
                    assignedData = assignedData.filter(d => d.login !== item.login);
                    renderList();
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
        var addInputEl = document.getElementById('assigned_seat_add_input');
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
            dropdownOptions: { constrainWidth: false, container: addInputEl.closest('dialog') || document.body },
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
                addInputEl.value = '';
                addInputEl.focus();
            }
        });

        renderList();
        return assignModal;
    }

    // init modal
    var actionEl = document.getElementById('action_modal');
    var actionModal =  warpDialog(actionEl);

    // register hooks
    var actionBtns = document.getElementsByClassName('plan_action_btn');

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
            actions.push('assign-modal');
            actions.push('assign');
            if (state == WarpSeat.SeatStates.DISABLED)
                actions.push('enable');
            else
                actions.push('disable');
        }

        if (!actions.length)
            return;

        let msg1El = document.getElementById("action_modal_msg1");
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

        let msg2El = document.getElementById("action_modal_msg2");
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
            p.innerText = TR("To be removed:");

            msg2El.appendChild(p);
            msg2El.appendChild(myConflictsTable);
        }

        for (let btn of actionBtns) {
            btn.classList.toggle('active', actions.includes(btn.dataset.action));
        }

        //var actionElTitle = document.getElementById('action_modal_title');
        //actionElTitle.innerText = "Seat: "+this.getName();

        seat = this;
        actionModal.open();
    });

    var actionBtnClicked = function(e) {

        // this is not a real action, it should just show modal
        // real action button is inside modal
        if (this.dataset.action == 'assign-modal') {
            var assignModal = initAssignedSeatsModal(seat);
            document.getElementById('assigned_seat_add_input').focus();
            assignModal.open();
            return;
        }

        var applyData = {};

        if (this.dataset.action == "assign" && typeof(PlanUserData) !== 'undefined') {
            applyData['assign'] = {
                sid: seat.getSid(),
                logins: assignedData.map(d => ({
                    login: d.login,
                    days_in_advance: d.days_in_advance
                }))
            };
        }

        if (this.dataset.action == 'enable' || this.dataset.action == 'disable') {
            applyData[this.dataset.action] = [ seat.getSid() ];
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

        Utils.xhr.post(
            window.warpGlobals.URLs['planApply'],
            applyData,
            {toastOnSuccess: false})
        .then( (value) => {

            var msg = "";

            if (value.response.conflicts_in_disable) {
                msg += TR("Seat is successfully disabled.<br>However there are existing reservations in the the next few weeks. " +
                      "Existing reservations are not automatically removed, it has to be done manually.<br><br>");
                let rList = [];
                for (let r of value.response.conflicts_in_disable) {
                    let dateStr = WarpSeatFactory._formatDatePair(r);
                    rList.push( escapeHtml(r.username) + "&nbsp;on&nbsp;" + dateStr.datetime1 + "&nbsp;" + dateStr.datetime2);
                }
                msg += rList.join('<br>');
            }

            if (value.response.conflicts_in_assign) {
                msg += TR("Seat is successfully assigned.<br>However there are non-assignees' existing reservations in the the next few weeks. " +
                      "Existing reservations are not automatically removed, it has to be done manually.<br><br>");
                let rList = [];
                for (let r of value.response.conflicts_in_assign) {
                    let dateStr = WarpSeatFactory._formatDatePair(r);
                    rList.push( escapeHtml(r.username) + "&nbsp;on&nbsp;" + dateStr.datetime1 + "&nbsp;" + dateStr.datetime2);
                }
                msg += rList.join('<br>');
            }

            if (value.response.conflicts_in_window) {
                if (msg) msg += "<br><br>";
                msg += TR("Some reservations are outside the new booking window and must be removed manually.") + "<br>";
                let rList = [];
                for (let r of value.response.conflicts_in_window) {
                    let dateStr = WarpSeatFactory._formatDatePair(r);
                    rList.push( escapeHtml(r.username) + "&nbsp;on&nbsp;" + dateStr.datetime1 + "&nbsp;" + dateStr.datetime2);
                }
                msg += rList.join('<br>');
            }

            if (msg == "")
                M.toast({text: TR('Action successfull.')});
            else
                WarpModal.getInstance().open(TR("Warning"),msg);

            downloadSeatData(seatFactory);
        }).catch( (value) => {
            downloadSeatData(seatFactory);
        });

    };

    for (let btn of actionBtns)
        btn.addEventListener('click',actionBtnClicked)

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

// (Calendar controls removed — no mode toggle, no clear link. Click adds a
// day, shift-click ranges; selection is additive and the only reset is a page
// reload, which restores the prefs default day.)

function initZoneHelp() {

    var helpModalEl = document.getElementById('planmap_help_modal');
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

    var helpModalSpriteDivs = document.getElementsByClassName("help_modal_sprite");
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

    var helpDiv = document.getElementsByClassName("planmap_help");
    for (let d of helpDiv) {
        d.addEventListener('click', function() { helpModal.open(); } )
    }


}

// The side panel is an inline column on desktop (default open) and a
// slide-in overlay on mobile (default closed). Toggled via a data-state
// attribute (CSS maps it to display:none on desktop, transform on mobile) — no
// Materialize Sidenav/overlay, which was greying the whole page on reopen.
// R6: init-time state only; the close button + schedule trigger flip the attr.
function initZoneSidepanel() {

    var el = document.getElementById('plan_sidepanel');
    var mobile = window.matchMedia('(max-width: 993px)').matches;
    el.setAttribute('data-state', mobile ? 'closed' : 'open');

    var closeBtn = document.querySelector('.plan_sidepanel_close');
    if (closeBtn) {
        closeBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            el.setAttribute('data-state', 'closed');
        });
    }
    var trig = document.querySelector('.planmap_datetime_trigger');
    if (trig) {
        trig.addEventListener('click', function() {
            el.setAttribute('data-state', 'open');
        });
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

    var fabBtn = document.getElementById('auto_book_btn');
    if (!fabBtn)
        return;

    fabBtn.title = TR("Find me a seat");

    function updateFabState() {
        var noDates = getSelectedDates().length === 0;
        var noChange = !noDates && seatFactory.isExactMatch();
        fabBtn.classList.toggle('disabled', noDates || noChange);
    }

    var slider = document.getElementById('timeslider');
    slider.noUiSlider.on('update', updateFabState);

    // Calendar selection drives fab state indirectly: onChange → updateSeatsView →
    // seatFactory.updateAllStates → 'updateAllStates' event → here. (Old code had a
    // per-.date_checkbox change listener; the calendar onChange replaces it.)
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
            window.warpGlobals.URLs['planAutoBook'],
            payload,
            { toastOnSuccess: false, toastOnError: true })
        .then(function(v) {
            showAutoBookResult(v.response);
            downloadSeatData(seatFactory);
        }).catch(function() {
            downloadSeatData(seatFactory);
        });
    });

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

        var table = container.appendChild(document.createElement('table'));
        for (let it of items) {
            let tr = table.appendChild(document.createElement('tr'));
            rowBuilder(tr, it);
        }
    }

    appendSection(TR("Booked:"), function(tr, b) {
        let f = WarpSeatFactory._formatDatePair(b);
        tr.appendChild(document.createElement('td')).innerText = b.seat_name;
        tr.appendChild(document.createElement('td')).innerText = f.datetime1;
        tr.appendChild(document.createElement('td')).innerText = f.datetime2;
    }, booked);

    appendSection(TR("Could not extend or rebook:"), function(tr, u) {
        let f = WarpSeatFactory._formatDatePair(u);
        tr.appendChild(document.createElement('td')).innerText = f.datetime1;
        tr.appendChild(document.createElement('td')).innerText = f.datetime2;
    }, notExtended);

    appendSection(TR("Could not book the following dates:"), function(tr, u) {
        let f = WarpSeatFactory._formatDatePair(u);
        tr.appendChild(document.createElement('td')).innerText = f.datetime1;
        let timeTd = tr.appendChild(document.createElement('td'));
        timeTd.innerText = f.datetime2;
        if (u.future_options && u.future_options.length) {
            for (let o of u.future_options) {
                let dateStr = new Date(o.available_from_ts * 1000).toISOString().substring(0, 10);
                timeTd.appendChild(document.createElement('br'));
                timeTd.appendChild(document.createTextNode(
                    TR("Seat %{seat_name} becomes available on %{date}",
                        {seat_name: o.seat_name, date: dateStr})));
            }
        }
    }, unbookable);

    if (!container.children.length) {
        container.appendChild(document.createTextNode(TR("No seat could be booked.")));
    }

    WarpModal.getInstance().open(TR("Auto book"), container.innerHTML);
}

document.addEventListener("DOMContentLoaded", function() {

    var slider = initSlider();
    // Restore persisted selection (migration from the old {cb,slider} shape —
    // R4). Applied BEFORE the calendar is composed so it sees stored defaults.
    var persisted = loadPlanSelections();
    slider.noUiSlider.set(persisted.slider);

    var seatFactory = new WarpSeatFactory(window.warpGlobals.login);

    var om = initOfficeMap(seatFactory);
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
        document.getElementById('plan_calendar_grid'),
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
        function applyPlanMapFilter() {
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
        }
        applyPlanMapFilter();
        new MutationObserver(applyPlanMapFilter).observe(document.documentElement, {
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
});
