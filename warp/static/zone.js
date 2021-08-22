"use strict";

function downloadSeatData(seatFactory) {

    var xhr = new XMLHttpRequest();
    xhr.addEventListener("load", function() {

        var seatData = JSON.parse(this.responseText);

        seatFactory.setSeatsData(seatData);
        seatFactory.updateAllStates( getSelectedDates());
    });

    xhr.open("GET", window.warpGlobals.URLs['getSeat']);
    xhr.send();
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
        range: { 'min': 0, 'max': 24*3600 }
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

    var seatFactory = new WarpSeatFactory(window.warpGlobals.URLs['seatSprite'],"zonemap",window.warpGlobals['zoneData']);

    // register WarpSeats for updates
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

function initSeatPreview(seatFactory) {

    var zoneMap = document.getElementById("zonemap");

    seatFactory.on( 'mouseover', function() {

        var previewDiv = document.createElement("div");
        previewDiv.className = 'seat_preview';
    
        var previewTitle = previewDiv.appendChild(document.createElement("div"));
        previewTitle.innerText = "Seat "+this.getName();
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
        var assignments = this.getAssignments();
        if (assignments.length) {

            var header = previewDiv.appendChild(document.createElement("span"));
            header.appendChild(document.createTextNode("Assigned to:"));
            header.className = "seat_preview_header";

            var table =  previewDiv.appendChild(document.createElement("table"));
            for (let a of assignments) {   
                var name = a;
                // assignments are either logins or usernames
                if (window.warpGlobals.URLs['userData'] && a in window.warpGlobals.URLs['userData'].data) {
                    name = actAsUserStr(a,window.warpGlobals.URLs['userData'].data[a]);        
                }             
                var tr = table.appendChild( document.createElement("tr"));
                tr.appendChild( document.createElement("td")).appendChild( document.createTextNode(name));                
            }
        }

        var bookings = this.getBookings();
        if (bookings.length) {
            
            var header = previewDiv.appendChild(document.createElement("span"))
            header.appendChild(document.createTextNode("Bookings:"));
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

function initAssignedSeatsModal(seat) {

    var assignModalEl = document.getElementById("assigned_seat_modal");
    if (!assignModalEl || !window.warpGlobals.URLs['userData'] || !window.warpGlobals.URLs['userData'].data) 
        return null;

    var assignModal = M.Modal.getInstance(assignModalEl);
    if (!assignModal) {
        assignModal = M.Modal.init(assignModalEl, {});
    }
    
    var chipsEl = document.getElementById('assigned_seat_chips');

    var chipsOptions;
    var chips = M.Chips.getInstance(chipsEl); 
    if (chips) {
        chipsOptions = chips.options;
        chips.destroy(); // we have to recreate chips instance to clean up all chips inside
    }
    else {

        var onChipApp = function(chip) {
    
            var i = this.chipsData.length - 1;  // chips are always pushed
            var t = this.chipsData[i].tag;
    
            if (!(t in this.autocomplete.options.data)) {
                this.deleteChip(i);
            }
        }
    
        var chipsAutocompleteData = {};
        for (let login in window.warpGlobals.URLs['userData'].data) {
            var userName = window.warpGlobals.URLs['userData'].data[login];
            chipsAutocompleteData[ actAsUserStr(login,userName)] = null;
        }
    
        chipsOptions = {
            autocompleteOptions: {
                data: chipsAutocompleteData,
                minLength: 1
                },
            limit: Infinity,
            onChipAdd: onChipApp
        };        
    }

    chips = M.Chips.init(chipsEl, chipsOptions);

    var assignments = seat.getAssignments();
    for (let login of assignments) {
        var userName = window.warpGlobals.URLs['userData'].data[login];
        chips.addChip({tag: actAsUserStr(login,userName)})
    }

    return assignModal;
}


function initActionMenu(seatFactory) {

    var seat = null;    // used for passing seat to btn click events (closure)
                        // it is set at the end of seatFactory.on('click'
                        // it is used in actionBtn click event
                        // and it is reset (to release reference) in actionModal onCloseEnd event

    // init modal
    var actionEl = document.getElementById('action_modal');
    var actionModal =  M.Modal.init(actionEl);

    // register hooks
    var actionBtns = document.getElementsByClassName('zone_action_btn');

    seatFactory.on( 'click', function() {

        var state = this.getState();

        if (state == WarpSeat.SeatStates.NOT_AVAILABLE)
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

        if (window.warpGlobals.isM) {
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
            p.innerText = "Seat "+this.getName()+" to be booked:";

            msg1El.appendChild(p);
            msg1El.appendChild(bookDatesTable);
        }

        let msg2El = document.getElementById("action_modal_msg2");
        msg2El.innerHTML = "";

        if (removeMsg) {            

            var myConflictsTable = document.createElement("table");
            for (let c of seatFactory.getMyConflictingBookings()) {
                let tr = myConflictsTable.appendChild(document.createElement("tr"));
                tr.appendChild( document.createElement("td")).innerText = c.zone_name
                tr.appendChild( document.createElement("td")).innerText = c.seat_name;
                tr.appendChild( document.createElement("td")).innerText = c.datetime1;
                tr.appendChild( document.createElement("td")).innerText = c.datetime2;
            }

            let p = document.createElement('P');
            p.innerText = "To be removed:";

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
            document.getElementById('assigned_seat_chips').focus();
            assignModal.open();
            return;
        }
 
        var xhr = new XMLHttpRequest();    
        xhr.open("POST", window.warpGlobals.URLs['zoneApply']);
        xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
        xhr.addEventListener("load", function(e) {
            if (this.status == 200) {
                var resp = JSON.parse(this.responseText);
                var msg = "";

                if (resp.conflicts_in_disable) {
                    msg += "Seat is successfully disabled.<br>However there are existing reservations in the the next few weeks.<br>" +
                          "Existing reservations are not automatically removed, it has to be done manually.<br><br>";
                    let rList = [];
                    for (let r of resp.conflicts_in_disable) {
                        let dateStr = WarpSeatFactory._formatDatePair(r);
                        rList.push( r.username + "&nbsp;on&nbsp;" + dateStr.datetime1 + "&nbsp;" + dateStr.datetime2);
                    }
                    msg += rList.join('<br>');
                }

                if (resp.conflicts_in_assign) {
                    msg += "Seat is successfully assigned.<br>However there are non-assignees' existing reservations in the the next few weeks.<br>" +
                          "Existing reservations are not automatically removed, it has to be done manually.<br><br>";
                    let rList = [];
                    for (let r of resp.conflicts_in_assign) {
                        let dateStr = WarpSeatFactory._formatDatePair(r);
                        rList.push( r.username + "&nbsp;on&nbsp;" + dateStr.datetime1 + "&nbsp;" + dateStr.datetime2);
                    }
                    msg += rList.join('<br>');
                }
                
                if (msg == "")
                    M.toast({html: 'Action successfull.'});
                else
                    WarpModal.getInstance().open("Warning",msg);
            }
            else {
                WarpModal.getInstance().open("Change unsuccessfull","Unable to apply the change. Probably the seat was already booked by someone else.<br>Status: "+this.status);
            }

            downloadSeatData(seatFactory);
        });

        var applyData = {};

        if (this.dataset.action == "assign") {
            var chipsEl = document.getElementById('assigned_seat_chips');
            var chips = M.Chips.getInstance(chipsEl);

            var logins = [];
            for (var c of chips.getData()) {
                logins.push(actAsUserStrRev(c.tag));
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
        }

        if (this.dataset.action == 'delete' || this.dataset.action == 'update') {
            applyData['remove'] = seatFactory.getMyConflictingBookings(true);
        }

        xhr.send( JSON.stringify(applyData));

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

function initZone() {

    initSlider();
    initDateSelectorStorage();
    initShiftSelectDates();

    var seatFactory = initSeats();
    initSeatPreview(seatFactory);
    initActionMenu(seatFactory);
    initZoneHelp();

    downloadSeatData(seatFactory);
}

window.addEventListener("load",initZone);