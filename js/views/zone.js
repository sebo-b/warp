"use strict";

import Utils from './modules/utils.js';
import WarpModal from './modules/modal.js';
import {WarpSeatFactory,WarpSeat} from './modules/seat.js';
import ZoneUserData from './modules/zoneuserdata.js';
import BookAs from './modules/bookas.js';

import "./css/zone/nouislider_materialize.scss";

let dateList = [];
let seatFactory;
let timeSlots = [{startTS: "8:00", endTS: "12:00"}, {startTS: "10:00", endTS: "14:00"}, {startTS: "14:00", endTS: "18:00"}]


function downloadSeatData(seatFactory) {

    let url = window.warpGlobals.URLs['getSeat'];

    let login = seatFactory.getLogin();
    if (login !== window.warpGlobals.login)
        url += "?login=" + login;

    Utils.xhr.get(url, {toastOnSuccess:false})
    .then( function(v) {

        seatFactory.setSeatsData(v.response);
        seatFactory.updateAllStates( getSelectedDates());

    })
}

function getSelectedDates() {

    const res = [];

    for(let i = 0; i < dateList.length; i++) {
        let dateStart = new Date(dateList[i]);
        let dateEnd = new Date(dateList[i]);
        dateStart.setHours(7);
        dateEnd.setHours(19);
        res.push( {
            fromTS: dateStart.getTime(),
            toTS: dateEnd.getTime()
        });
    }
    return res;
}

function handleOnClickDatePicker() {
    if(!dateList.includes(this.value)) {
        dateList.push(this.value);
    }

    renderSelectedDates();
}

function renderSelectedDates() {
    let container = document.getElementById("selectedDates");
    clearSelectedDates();
    dateList.sort();
    for(let i = 0; i < dateList.length; i++) {
        const dateEntryContainer = document.createElement("div");
        dateEntryContainer.classList = "zone_date_entry_container browser-default";

        const dateEntry = document.createElement("div");
        dateEntry.classList = "zone_date_entry browser-default"

        const datetag = document.createElement("p");
        datetag.innerText = new Date(dateList[i]).toLocaleDateString("de-DE", { weekday: 'short', day: '2-digit', month: '2-digit', year: "numeric" });

        const removeDateButton = document.createElement("button");
        removeDateButton.classList = "zone_remove_date_button";
        removeDateButton.innerText = "Entfernen";
        removeDateButton.onclick = () => removeDateEntry(dateList[i]);

        //slot options
        // const collapsibleButton = document.createElement("button");
        // collapsibleButton.classList="collapsible";
        // collapsibleButton.innerText="Erweiterte Optionen";
        // collapsibleButton.id = "collapsible" + i;

        // const slotContainer = document.createElement("div");
        // slotContainer.classList = "slot_container browser-default";

        // for(let i = 0; i < timeSlots.length; i++) {

        //             const slot = document.createElement("div");
        //             slot.classList = "zone_checkbox_container";

        //             const halfdayInput = document.createElement("input");
        //             halfdayInput.type = "checkbox";
        //             halfdayInput.name = "halfdayInput" + timeSlots[i].startTS;
        //             halfdayInput.id = "halfdayInput" + timeSlots[i].startTS;
        //             halfdayInput.value = timeSlots[i].startTS;
        //             halfdayInput.classList = "checkbox browser-default"; 
            
        //             const halfdayInputLabel = document.createElement("label");
        //             halfdayInputLabel.appendChild(document.createTextNode(timeSlots[i].startTS + " Uhr - " + timeSlots[i].endTS + " Uhr"));
        //             halfdayInputLabel.htmlFor="halfdayInput" + timeSlots[i].startTS;

        //             slot.appendChild(halfdayInput);
        //             slot.appendChild(halfdayInputLabel);
        //             slotContainer.appendChild(slot);

        // }

        dateEntry.appendChild(datetag);
        dateEntry.appendChild(removeDateButton);
        dateEntryContainer.appendChild(dateEntry);
        //dateEntryContainer.appendChild(collapsibleButton);
        //dateEntryContainer.appendChild(slotContainer);
        container.appendChild(dateEntryContainer);
        seatFactory.updateAllStates(getSelectedDates());

        initCollapsibles();
    }
}

function initDatePicker() {
    const datepicker = document.getElementById("datepicker");
    const numOfWeeks = 1;
    const today = new Date();
    datepicker.addEventListener("change", handleOnClickDatePicker, false);
    datepicker.value = today.getDate();
    datepicker.min = today.toISOString().split("T")[0];
    datepicker.max = new Date(today.setDate(today.getDate() + numOfWeeks * 7)).toISOString().split("T")[0];

    return datepicker;
} 

function initCollapsibles() {
    var coll = document.getElementsByClassName("collapsible");

    for (let i = 0; i < coll.length; i++) {
        coll[i].addEventListener("click", function() {
          this.classList.toggle("active");
          var content = this.nextElementSibling;
          if (content.style.display === "block") {
            content.style.display = "none";
          } else {
            content.style.display = "block";
          }
        });
      }
}

function clearSelectedDates() {
    let container = document.getElementById("selectedDates");
    while(container.childElementCount > 0) {
        container.removeChild(container.firstElementChild);
    }
}

function removeDateEntry(datestring) {
    dateList = dateList.filter((elem) => elem !== datestring );
    renderSelectedDates();
    
}


function initSeats() {

    seatFactory = new WarpSeatFactory(
        window.warpGlobals.URLs['seatSprite'],
        "zonemap",
        window.warpGlobals.login);

    return seatFactory;
}

function initSeatPreview(seatFactory) {

    const zoneMap = document.getElementById("zonemap");

    seatFactory.on( 'mouseover', function() {

        const previewDiv = document.createElement("div");
        previewDiv.className = 'seat_preview';

        let previewTitle = previewDiv.appendChild(document.createElement("div"));
        previewTitle.innerText = TR("Seat %{seat_name}",{seat_name: this.getName()});
        previewTitle.className = "seat_preview_title";

        // position of the frame
        const pands = this.getPositionAndSize();

        let parentWidth = zoneMap.clientWidth;
        let clientPosX = pands.x - zoneMap.scrollLeft;

        if (clientPosX < parentWidth / 2) {
            previewDiv.style.right = "";
            previewDiv.style.left = (pands.x + pands.size * 0.70) + "px";
        }
        else {
            previewDiv.style.left = "";
            previewDiv.style.right = (parentWidth - pands.x - pands.size * 0.30) + "px";
        }

        let parentHeight = zoneMap.clientHeight;
        let clientPosY = pands.y;

        if (clientPosY < parentHeight / 2) {
            previewDiv.style.top = (pands.y + pands.size * 0.70) + "px";
            previewDiv.style.bottom = "";
        }
        else {
            previewDiv.style.top = "";
            previewDiv.style.bottom = (parentHeight - pands.y - pands.size * 0.30) + "px";
        }

        // content of the frame
        let assignments = Object.values(this.getAssignments());
        if (assignments.length) {

            let header = previewDiv.appendChild(document.createElement("span"));
            header.appendChild(document.createTextNode(TR("Assigned to:")));
            header.className = "seat_preview_header";

            let table =  previewDiv.appendChild(document.createElement("table"));
            for (let a of assignments) {
                let tr = table.appendChild( document.createElement("tr"));
                tr.appendChild( document.createElement("td")).appendChild( document.createTextNode(a));
            }
        }

        let bookings = this.getBookings();
        if (bookings.length) {

            let header = previewDiv.appendChild(document.createElement("span"))
            header.appendChild(document.createTextNode(TR("Bookings:")));
            header.className = "seat_preview_header";

            let table =  previewDiv.appendChild(document.createElement("table"));
            let maxToShow = 8;

            for (let b of bookings) {

                if (maxToShow-- == 0) {
                    b.datetime1 = "...";
                    b.datetime2 = "";
                    b.username = "";
                }

                let tr = table.appendChild( document.createElement("tr"));
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
        let previewDivs = document.getElementsByClassName('seat_preview');
        for (let d of previewDivs) {
            d.remove();
        }
    });

}

function initAssignedSeatsModal(seat) {

    let assignModalEl = document.getElementById("assigned_seat_modal");
    if (!assignModalEl || typeof(ZoneUserData) === 'undefined')
        return null;

    let assignModal = M.Modal.getInstance(assignModalEl);
    if (!assignModal) {
        assignModal = M.Modal.init(assignModalEl, {});
    }

    let zoneUserData = ZoneUserData.getInstance();

    let chipsEl = document.getElementById('assigned_seat_chips');

    let chipsOptions;
    let chips = M.Chips.getInstance(chipsEl);
    if (chips) {
        chipsOptions = chips.options;
        chips.destroy(); // we have to recreate chips instance to clean up all chips inside
    }
    else {

        let onChipApp = function(chip) {

            let i = this.chipsData.length - 1;  // chips are always pushed
            let t = this.chipsData[i].tag;

            if (!(t in this.autocomplete.options.data)) {
                this.deleteChip(i);
            }
        }

        let chipsAutocompleteData = {};
        for (let d of zoneUserData.formatedIterator()) {
            chipsAutocompleteData[ d] = null;
        }

        chipsOptions = {
            autocompleteOptions: {
                data: chipsAutocompleteData,
                minLength: 1,
                dropdownOptions: {
                    container: document.body,
                    constrainWidth: false
                }
            },
            limit: Infinity,
            onChipAdd: onChipApp
        };
    }

    chips = M.Chips.init(chipsEl, chipsOptions);

    let assignments = seat.getAssignments();
    for (let login in assignments) {
        chips.addChip({tag: ZoneUserData.makeUserStr(login,assignments[login])})
    }

    return assignModal;
}

function initActionMenu(seatFactory) {

    if (window.warpGlobals.isZoneViewer)
        return;

    let seat = null;    // used for passing seat to btn click events (closure)
                        // it is set at the end of seatFactory.on('click'
                        // it is used in actionBtn click event
                        // and it is reset (to release reference) in actionModal onCloseEnd event

    // init modal
    let actionEl = document.getElementById('action_modal');
    let actionModal =  M.Modal.init(actionEl);

    // register hooks
    let actionBtns = document.getElementsByClassName('zone_action_btn');

    seatFactory.on( 'click', function() {

        let state = this.getState();

        if (state == WarpSeat.SeatStates.NOT_AVAILABLE)
            return;

        let actions = [];
        let bookMsg = false;
        let removeMsg = false;

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

            let bookDatesTable = document.createElement("table");
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

            let myConflictsTable = document.createElement("table");
            for (let c of seatFactory.getMyConflictingBookings()) {
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

        //let actionElTitle = document.getElementById('action_modal_title');
        //actionElTitle.innerText = "Seat: "+this.getName();

        seat = this;
        actionModal.open();
    });

    let actionBtnClicked = function(e) {

        // this is not a real action, it should just show modal
        // real action button is inside modal
        if (this.dataset.action == 'assign-modal') {
            let assignModal = initAssignedSeatsModal(seat);
            document.getElementById('assigned_seat_chips').focus();
            assignModal.open();
            return;
        }

        let applyData = {};

        if (this.dataset.action == "assign" && typeof(ZoneUserData) !== 'undefined') {

            let chipsEl = document.getElementById('assigned_seat_chips');
            let chips = M.Chips.getInstance(chipsEl);

            let logins = [];
            for (let c of chips.getData()) {
                logins.push(ZoneUserData.makeUserStrRev(c.tag));
            }

            applyData['assign'] = {
                sid: seat.getSid(),
                logins: logins
            }
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
            applyData['remove'] = seatFactory.getMyConflictingBookings(true);
        }

        Utils.xhr.post(
            window.warpGlobals.URLs['zoneApply'],
            applyData,
            {toastOnSuccess: false})
        .then( (value) => {

            let msg = "";

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

    let storage = window.sessionStorage;

    // restore values from session storage
    let restoredSelections = storage.getItem('zoneSelections');
    restoredSelections = restoredSelections? JSON.parse(restoredSelections): window.warpGlobals['defaultSelectedDates'];

    let cleanCBSelections = []; // used to clean up the list of checkboxes doesn't exist anymore

    restoredSelections.cb = cleanCBSelections;

    storage.setItem('zoneSelections', JSON.stringify(restoredSelections));



}

function initShiftSelectDates() {

    // find lowest selected value
    let lastSelectedValue = 0;
    for (let cb of document.getElementsByClassName('date_checkbox')) {
        if (cb.checked) {
            if (lastSelectedValue === 0)
                lastSelectedValue = parseInt(cb.value);
            else
                lastSelectedValue = Math.min( parseInt(cb.value), lastSelectedValue);
        }
    }

    let cbClick = function(e) {

        if (e.shiftKey)
        {
            let targetState = this.checked; // materialize has already changed the state
            let minValue  = Math.min( parseInt(this.value), lastSelectedValue);
            let maxValue  = Math.max( parseInt(this.value), lastSelectedValue);

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

    let helpModalEl = document.getElementById('zonemap_help_modal');
    let helpModal = M.Modal.init(helpModalEl);

    let helpModalSpriteDivs = document.getElementsByClassName("help_modal_sprite");
    for (let d of helpModalSpriteDivs) {
        d.style.width = WarpSeat.Sprites.spriteSize + "px";
        d.style.height = WarpSeat.Sprites.spriteSize + "px";
        d.style.backgroundImage = 'url('+window.warpGlobals.URLs['seatSprite']+')';

        let type = d.dataset.sprite + "Offset";
        d.style.backgroundPositionX = WarpSeat.Sprites[type];
    }

    let helpDiv = document.getElementsByClassName("zonemap_help");
    for (let d of helpDiv) {
        d.addEventListener('click', function() { helpModal.open(); } )
    }


}

function initZoneSidepanel() {

    let el = document.getElementById('zone_sidepanel');
    M.Sidenav.init(el, {
        onCloseEnd: function(e) {
            e.style.transform = "";
        }
    });
}

function initBookAs(seatFactory) {

    BookAs.getInstance().on('change', function(newLogin) {

        let url = window.warpGlobals.URLs['getSeat'] + "?onlyOtherZone=1&login=" + newLogin;
        Utils.xhr.get(url,{toastOnSuccess: false})
        .then( function(v) {
            seatFactory.updateLogin(newLogin, v.response);
            seatFactory.updateAllStates( getSelectedDates());

        });
    })

}

document.addEventListener("DOMContentLoaded", function() {
    dateList.push(new Date().toLocaleDateString("fr-CA"))
    
    initDatePicker();
    //initDateSelectorStorage();
    initShiftSelectDates();
    
    let seatFactory = initSeats();
    initSeatPreview(seatFactory);
    initActionMenu(seatFactory);
    initZoneHelp();
    initZoneSidepanel();
    
    downloadSeatData(seatFactory);
    
    if (window.warpGlobals.isZoneAdmin) {
        ZoneUserData.init();
        initBookAs(seatFactory);
    }
    renderSelectedDates();
});
