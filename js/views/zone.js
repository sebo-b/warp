"use strict";

import Utils from './modules/utils.js';
import WarpModal from './modules/modal.js';
import {WarpSeatFactory,WarpSeat,EVERYONE_KEY} from './modules/seat.js';
import ZoneUserData from './modules/zoneuserdata.js';
import BookAs from './modules/bookas.js';

import noUiSlider from 'nouislider';
import "./css/zone/nouislider_materialize.scss";

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
    var slider = document.getElementById('timeslider');
    var times = slider.noUiSlider.get(true);

    // if next day 00:00, move it one second back
    if (times[1] == 24*3600)
        times[1] = 24*3600-1;

    var res = [];

    for (var e of document.getElementsByClassName('date_checkbox')) {
        if (e.checked) {
            res.push( {
                fromTS: parseInt(e.value) + parseInt(times[0]),
                toTS: parseInt(e.value) + parseInt(times[1])
            });
        }
    };

    return res;
}

function initSlider() {

    var slider = document.getElementById('timeslider');
    noUiSlider.create(slider, {
        start: window.warpGlobals['defaultSelectedDates'].slider,    //this later on can be anyway overwritten from session storage
        connect: true,
        behaviour: 'drag',
        step: 15*60,
        margin: 15*60,
        orientation: 'vertical',
        range: { min: +slider.dataset.min, max: +slider.dataset.max }
    });

    var minDiv = document.getElementById('timeslider-min');
    var maxDiv = document.getElementById('timeslider-max');
    slider.noUiSlider.on('update', function(values, handle, unencoded, tap, positions, noUiSlider) {
        minDiv.innerText = new Date(unencoded[0]*1000).toISOString().substring(11,16)
        maxDiv.innerText = unencoded[1] == 24*3600? "23:59": new Date(unencoded[1]*1000).toISOString().substring(11,16);
    });

    return slider;
}

function initSeats() {

    var seatFactory = new WarpSeatFactory(
        window.warpGlobals.URLs['seatSprite'],
        "zonemap",
        window.warpGlobals.login);

    var updateSeatsView = function() {
        var dates = getSelectedDates();
        seatFactory.updateAllStates(dates);
    }

    var slider = document.getElementById('timeslider');
    slider.noUiSlider.on('update', updateSeatsView);

    for (var e of document.getElementsByClassName('date_checkbox')) {
        e.addEventListener('change',updateSeatsView);
    }

    return seatFactory;
}

function initSeatLabels(seatFactory) {

    var labelsContainer = document.getElementById("zonemap-labels");
    if (!labelsContainer) return;

    var prefs = window.warpGlobals['zonePreviewPrefs'] || {};
    var labelData = {};
    var labelSignatures = {};
    var needsFullRender = true;
    var hoveredSid = null;
    var suppressTooltip = false;
    var multiZone = false; // true when more than one zone on the plan

    var TITLE_HEIGHT = 14;
    var SPRITE_CENTER_X = WarpSeat.Sprites.spriteSize / 2;

    function positionLabel(div, pands) {
        div.style.left = (pands.x + SPRITE_CENTER_X) + "px";
        div.style.top = (pands.y + WarpSeat.Sprites.spriteSize - TITLE_HEIGHT) + "px";
    }

    function computeSignature(seat, showSeatNames, showBookingPreview) {
        var bookings = showBookingPreview ? seat.getBookings() : [];
        var users = [];
        var seen = new Set();
        for (var b of bookings) {
            if (seen.has(b.username)) continue;
            seen.add(b.username);
            users.push(b.username);
        }
        return (showSeatNames ? seat.getName() : '') + '\x00' + users.join('\x01');
    }

    function buildContentDiv(seat, showSeatNames, showBookingPreview) {

        var bookings = showBookingPreview ? seat.getBookings() : [];

        if (!showSeatNames && !bookings.length) return null;

        var div = document.createElement("div");
        div.className = "seat_label";

        if (showSeatNames) {
            var title = div.appendChild(document.createElement("div"));
            title.className = "seat_label_title";
            title.textContent = seat.getName();
        }

        if (showBookingPreview && bookings.length) {
            var content = div.appendChild(document.createElement("div"));
            content.className = "seat_label_content";

            var seen = new Set();
            for (var b of bookings) {
                if (seen.has(b.username)) continue;
                seen.add(b.username);
                var row = content.appendChild(document.createElement("div"));
                row.className = "seat_label_booking";
                row.textContent = b.username;
            }
        }

        // Show zone name when multiple zones exist on the plan
        if (multiZone && (showSeatNames || showBookingPreview)) {
            var zoneName = div.appendChild(document.createElement("div"));
            zoneName.className = "seat_label_zone";
            zoneName.textContent = seat.getZoneName();
        }

        return div;
    }

    function renderLabels() {

        for (var sid in labelData) {
            if (labelData[sid]) labelData[sid].remove();
        }
        labelData = {};
        labelSignatures = {};

        var showSeatNames = prefs.show_seat_names;
        var showBookingPreview = prefs.show_booking_preview;

        if (!showSeatNames && !showBookingPreview) {
            needsFullRender = false;
            return;
        }

        for (var sid in seatFactory.instances) {
            var seat = seatFactory.instances[sid];
            if (seat.isOtherZone()) continue;

            var div = buildContentDiv(seat, showSeatNames, showBookingPreview);
            if (!div) continue;

            positionLabel(div, seat.getPositionAndSize());
            if (sid == hoveredSid) div.classList.add("seat_label_hidden");

            labelsContainer.appendChild(div);
            labelData[sid] = div;
            labelSignatures[sid] = computeSignature(seat, showSeatNames, showBookingPreview);
        }

        needsFullRender = false;
    }

    function updateBookingLabels() {

        if (needsFullRender) {
            renderLabels();
            return;
        }

        var showSeatNames = prefs.show_seat_names;
        var showBookingPreview = prefs.show_booking_preview;

        for (var sid in seatFactory.instances) {
            var seat = seatFactory.instances[sid];
            if (seat.isOtherZone()) continue;

            var bookings = showBookingPreview ? seat.getBookings() : [];
            var existingDiv = labelData[sid];

            if (!showSeatNames && !bookings.length) {
                if (existingDiv) {
                    existingDiv.remove();
                    delete labelData[sid];
                    delete labelSignatures[sid];
                }
                continue;
            }

            var newSig = computeSignature(seat, showSeatNames, showBookingPreview);
            if (existingDiv && labelSignatures[sid] === newSig) continue;

            var div = buildContentDiv(seat, showSeatNames, showBookingPreview);
            if (!div) {
                if (existingDiv) {
                    existingDiv.remove();
                    delete labelData[sid];
                    delete labelSignatures[sid];
                }
                continue;
            }

            positionLabel(div, seat.getPositionAndSize());
            if (sid == hoveredSid) div.classList.add("seat_label_hidden");

            labelsContainer.appendChild(div);
            labelData[sid] = div;
            labelSignatures[sid] = newSig;

            if (existingDiv) existingDiv.remove();
        }
    }

    function refreshAllLabels() {
        needsFullRender = true;
        renderLabels();
    }

    seatFactory.on('setSeatsData', function() {
        needsFullRender = true;
        hoveredSid = null;
        suppressTooltip = false;
        // Determine if plan has multiple zones
        var zoneIds = new Set();
        for (var sid in seatFactory.instances) {
            var seat = seatFactory.instances[sid];
            if (seat.isOtherZone()) continue;
            zoneIds.add(seat.getZoneName());
        }
        multiZone = zoneIds.size > 1;
    });

    seatFactory.on('updateAllStates', updateBookingLabels);

    seatFactory.on('mouseover', function() {
        var sid = String(this.getSid());
        hoveredSid = sid;

        var hasAssignments = Object.keys(this.getAssignments()).length > 0;
        var hasBookings = this.getBookings().length > 0;

        if (prefs.show_seat_names && !hasAssignments && !hasBookings) {
            suppressTooltip = true;
        } else {
            suppressTooltip = false;
            if (labelData[sid]) labelData[sid].classList.add("seat_label_hidden");
        }
    });

    seatFactory.on('mouseout', function() {
        if (hoveredSid && labelData[hoveredSid]) labelData[hoveredSid].classList.remove("seat_label_hidden");
        hoveredSid = null;
        suppressTooltip = false;
    });

    document.addEventListener('warp:prefsSaved', function(e) {
        var newPrefs = e.detail && e.detail.zonePreviewPrefs;
        if (!newPrefs) return;
        prefs.show_seat_names = !!newPrefs.show_seat_names;
        prefs.show_booking_preview = !!newPrefs.show_booking_preview;
        refreshAllLabels();
    });

    return {
        refreshAllLabels: refreshAllLabels,
        shouldSuppressTooltip: function() { return suppressTooltip; }
    };
}

function initSeatPreview(seatFactory, seatLabels) {

    var zoneMap = document.getElementById("zonemap");

    seatFactory.on( 'mouseover', function() {

        if (seatLabels && seatLabels.shouldSuppressTooltip()) return;

        var previewDiv = document.createElement("div");
        previewDiv.className = 'seat_preview';

        var previewTitle = previewDiv.appendChild(document.createElement("div"));
        previewTitle.innerText = TR("Seat %{seat_name}",{seat_name: this.getName()});
        previewTitle.className = "seat_preview_title";

        // position of the frame
        var pands = this.getPositionAndSize();

        var parentWidth = zoneMap.clientWidth;
        var clientPosX = pands.x - zoneMap.scrollLeft;

        if (clientPosX < parentWidth / 2) {
            previewDiv.style.right = "";
            previewDiv.style.left = (pands.x + pands.size * 0.70) + "px";
        }
        else {
            previewDiv.style.left = "";
            previewDiv.style.right = (parentWidth - pands.x - pands.size * 0.30) + "px";
        }

        var parentHeight = zoneMap.clientHeight;
        var clientPosY = pands.y;

        if (clientPosY < parentHeight / 2) {
            previewDiv.style.top = (pands.y + pands.size * 0.70) + "px";
            previewDiv.style.bottom = "";
        }
        else {
            previewDiv.style.top = "";
            previewDiv.style.bottom = (parentHeight - pands.y - pands.size * 0.30) + "px";
        }

        // content of the frame
        var allAssignments = Object.values(this.getAssignments());
        var visibleAssignments = allAssignments.filter(a => !a.isEveryone);
        var everyoneAssignment = allAssignments.find(a => a.isEveryone);

        if (visibleAssignments.length) {

            var header = previewDiv.appendChild(document.createElement("span"));
            header.appendChild(document.createTextNode(TR("Assigned to:")));
            header.className = "seat_preview_header";

            var table =  previewDiv.appendChild(document.createElement("table"));
            for (let a of visibleAssignments) {
                var tr = table.appendChild( document.createElement("tr"));
                tr.appendChild( document.createElement("td")).appendChild( document.createTextNode(a.name));
                var diaText = a.days_in_advance !== null ? "(" + a.days_in_advance + "d)" : "";
                tr.appendChild( document.createElement("td")).appendChild( document.createTextNode(diaText));
            }
        }

        if (everyoneAssignment) {
            var evHeader = previewDiv.appendChild(document.createElement("span"));
            var diaText = everyoneAssignment.days_in_advance !== null
                ? TR("Available to everyone (up to %{n}d in advance)", {n: everyoneAssignment.days_in_advance})
                : TR("Available to everyone");
            evHeader.appendChild(document.createTextNode(diaText));
            evHeader.className = "seat_preview_header";
        }

        var bookings = this.getBookings();
        if (bookings.length) {

            var header = previewDiv.appendChild(document.createElement("span"))
            header.appendChild(document.createTextNode(TR("Bookings:")));
            header.className = "seat_preview_header";

            var table =  previewDiv.appendChild(document.createElement("table"));
            var maxToShow = 8;

            for (var b of bookings) {

                if (maxToShow-- == 0) {
                    b.datetime1 = "...";
                    b.datetime2 = "";
                    b.username = "";
                }

                var tr = table.appendChild( document.createElement("tr"));
                tr.appendChild( document.createElement("td")).innerText = b.datetime1;
                tr.appendChild( document.createElement("td")).innerText = b.datetime2;
                tr.appendChild( document.createElement("td")).innerText = b.username;

                if (maxToShow == 0)
                    break;
            }
        }

        zoneMap.appendChild(previewDiv);
    });

    seatFactory.on( 'mouseout', function() {
        var previewDivs = document.getElementsByClassName('seat_preview');
        for (var d of previewDivs) {
            d.remove();
        }
    });

}



function initActionMenu(seatFactory) {

    if (window.warpGlobals.isZoneViewer)
        return;

    var seat = null;    // used for passing seat to btn click events (closure)
    var assignedData = [];

    function initAssignedSeatsModal(seatArg) {

        var assignModalEl = document.getElementById("assigned_seat_modal");
        if (!assignModalEl || typeof(ZoneUserData) === 'undefined')
            return null;

        var assignModal = M.Modal.getInstance(assignModalEl);
        if (!assignModal)
            assignModal = M.Modal.init(assignModalEl, {});

        var zoneUserData = ZoneUserData.getInstance();
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
                delBtn.innerHTML = '<i class="material-icons small red-text text-darken-3">delete</i>';
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
            autocompleteData[ ZoneUserData.makeUserStr(login, userData[login]) ] = null;

        M.Autocomplete.init(addInputEl, {
            data: autocompleteData,
            dropdownOptions: { constrainWidth: false, container: document.body },
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
    var actionModal =  M.Modal.init(actionEl);

    // register hooks
    var actionBtns = document.getElementsByClassName('zone_action_btn');

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
            if (actions.includes(btn.dataset.action))
                btn.style.display = "inline-block";
            else
                btn.style.display = "none";
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

        if (this.dataset.action == "assign" && typeof(ZoneUserData) !== 'undefined') {
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
            window.warpGlobals.URLs['zoneApply'],
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
                    rList.push( r.username + "&nbsp;on&nbsp;" + dateStr.datetime1 + "&nbsp;" + dateStr.datetime2);
                }
                msg += rList.join('<br>');
            }

            if (value.response.conflicts_in_assign) {
                msg += TR("Seat is successfully assigned.<br>However there are non-assignees' existing reservations in the the next few weeks. " +
                      "Existing reservations are not automatically removed, it has to be done manually.<br><br>");
                let rList = [];
                for (let r of value.response.conflicts_in_assign) {
                    let dateStr = WarpSeatFactory._formatDatePair(r);
                    rList.push( r.username + "&nbsp;on&nbsp;" + dateStr.datetime1 + "&nbsp;" + dateStr.datetime2);
                }
                msg += rList.join('<br>');
            }

            if (value.response.conflicts_in_window) {
                if (msg) msg += "<br><br>";
                msg += TR("Some reservations are outside the new booking window and must be removed manually.") + "<br>";
                let rList = [];
                for (let r of value.response.conflicts_in_window) {
                    let dateStr = WarpSeatFactory._formatDatePair(r);
                    rList.push( r.username + "&nbsp;on&nbsp;" + dateStr.datetime1 + "&nbsp;" + dateStr.datetime2);
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
function initDateSelectorStorage() {

    var storage = window.sessionStorage;

    // restore values from session storage
    var restoredSelections = storage.getItem('zoneSelections');
    restoredSelections = restoredSelections? JSON.parse(restoredSelections): window.warpGlobals['defaultSelectedDates'];

    let cleanCBSelections = []; // used to clean up the list of checkboxes doesn't exist anymore

    // if nothing is selected, let's force default selection, hence 2 tries
    for (let i = 0; i < 2; ++i) {

        for (let cb of document.getElementsByClassName('date_checkbox')) {
            let ts = parseInt(cb.value)
            if (restoredSelections.cb.includes(ts)) {
                cb.checked = true;
                cleanCBSelections.push(ts);
            }
        }

        if (cleanCBSelections.length)
            break;

        restoredSelections.cb = window.warpGlobals['defaultSelectedDates'].cb;
    }

    restoredSelections.cb = cleanCBSelections;

    var slider = document.getElementById('timeslider');
    slider.noUiSlider.set(restoredSelections.slider);

    storage.setItem('zoneSelections', JSON.stringify(restoredSelections));

    var cbChange = function(e) {
        let zoneSelections = JSON.parse( storage.getItem('zoneSelections'));

        let ts = parseInt(this.value);
        if (this.checked)
            zoneSelections.cb.push(ts);
        else
            zoneSelections.cb.splice( zoneSelections.cb.indexOf(ts), 1);

        storage.setItem('zoneSelections', JSON.stringify(zoneSelections));
    }

    for (let cb of document.getElementsByClassName('date_checkbox'))
        cb.addEventListener('change', cbChange);

    slider.noUiSlider.on('update', function(values, handle, unencoded, tap, positions, noUiSlider) {

        let zoneSelections = JSON.parse( storage.getItem('zoneSelections'));
        zoneSelections.slider = values;
        storage.setItem('zoneSelections', JSON.stringify(zoneSelections));

    });

}

function initShiftSelectDates() {

    // find lowest selected value
    var lastSelectedValue = 0;
    for (let cb of document.getElementsByClassName('date_checkbox')) {
        if (cb.checked) {
            if (lastSelectedValue === 0)
                lastSelectedValue = parseInt(cb.value);
            else
                lastSelectedValue = Math.min( parseInt(cb.value), lastSelectedValue);
        }
    }

    var cbClick = function(e) {

        if (e.shiftKey)
        {
            var targetState = this.checked; // materialize has already changed the state
            var minValue  = Math.min( parseInt(this.value), lastSelectedValue);
            var maxValue  = Math.max( parseInt(this.value), lastSelectedValue);

            for (let cb of document.getElementsByClassName('date_checkbox')) {
                if (parseInt(cb.value) >= minValue && parseInt(cb.value) <= maxValue) {
                    if (cb != this && cb.checked != targetState) {
                        cb.checked = targetState;
                        cb.dispatchEvent(
                            new Event('change', {bubbles: true, cancelable: false}));
                    }
                }

            }

            // we should not call preventDefault() as this checkbox must be switched as well (and 'change' event dispatched)
        }

        lastSelectedValue = parseInt(this.value);
    }

    for (let cb of document.getElementsByClassName('date_checkbox'))
        cb.addEventListener('click', cbClick);

}

function initZoneHelp() {

    var helpModalEl = document.getElementById('zonemap_help_modal');
    var helpModal = M.Modal.init(helpModalEl);

    var helpModalSpriteDivs = document.getElementsByClassName("help_modal_sprite");
    for (let d of helpModalSpriteDivs) {
        d.style.width = WarpSeat.Sprites.spriteSize + "px";
        d.style.height = WarpSeat.Sprites.spriteSize + "px";
        d.style.backgroundImage = 'url('+window.warpGlobals.URLs['seatSprite']+')';

        var type = d.dataset.sprite + "Offset";
        d.style.backgroundPositionX = WarpSeat.Sprites[type];
    }

    var helpDiv = document.getElementsByClassName("zonemap_help");
    for (let d of helpDiv) {
        d.addEventListener('click', function() { helpModal.open(); } )
    }


}

function initZoneSidepanel() {

    var el = document.getElementById('zone_sidepanel');
    M.Sidenav.init(el, {
        onCloseEnd: function(e) {
            e.style.transform = "";
        }
    });
}

function initBookAs(seatFactory) {

    BookAs.getInstance().on('change', function(newLogin) {

        var url = window.warpGlobals.URLs['getSeat'] + "?onlyOtherZone=1&login=" + newLogin;
        Utils.xhr.get(url,{toastOnSuccess: false})
        .then( function(v) {
            seatFactory.updateLogin(newLogin, v.response);
            seatFactory.updateAllStates( getSelectedDates());

        });
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

    for (var e of document.getElementsByClassName('date_checkbox')) {
        e.addEventListener('change', updateFabState);
    }

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
            window.warpGlobals.URLs['zoneAutoBook'],
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
    var elsewhere = resp.already_booked_elsewhere || [];
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

    appendSection(TR("Already booked in another zone:"), function(tr, b) {
        let f = WarpSeatFactory._formatDatePair(b);
        tr.appendChild(document.createElement('td')).innerText = b.zone_name;
        tr.appendChild(document.createElement('td')).innerText = b.seat_name;
        tr.appendChild(document.createElement('td')).innerText = f.datetime1;
        tr.appendChild(document.createElement('td')).innerText = f.datetime2;
    }, elsewhere);

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

    initSlider();
    initDateSelectorStorage();
    initShiftSelectDates();

    var seatFactory = initSeats();
    var seatLabels = initSeatLabels(seatFactory);
    initSeatPreview(seatFactory, seatLabels);
    initActionMenu(seatFactory);
    initZoneHelp();
    initZoneSidepanel();

    downloadSeatData(seatFactory);

    initAutoBook(seatFactory);

    if (window.warpGlobals.isZoneAdmin) {
        ZoneUserData.init();
        initBookAs(seatFactory);
    }
});
