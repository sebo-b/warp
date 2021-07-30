"use strict";

function downloadSeatData(seatFactory) {

    var xhr = new XMLHttpRequest();
    xhr.addEventListener("load", function() {

        var seatData = JSON.parse(this.responseText);

        seatFactory.setSeatsData(seatData);
        seatFactory.updateAllStates( getSelectedDates());
    });

    xhr.open("GET", getSeatURL);
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
        start: defaultSelections.slider,    //this later on can be anyway overwritten from session storage
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

    var seatFactory = new WarpSeatFactory(seatSpriteURL,"zonemap",zoneData);

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

    var previewDiv = document.getElementById('seat_preview');

    seatFactory.on( 'mouseover', function() {
    
        if (this.getState() != WarpSeat.SeatStates.TAKEN &&
            this.getState() != WarpSeat.SeatStates.CAN_DELETE)
            return;
    
        previewDiv.innerHTML = "";

        // position of the frame
        var pands = this.getPositionAndSize();
        var parentWidth = previewDiv.parentNode.clientWidth
        
        if (pands.x < parentWidth / 2) {
            previewDiv.style.right = "";
            previewDiv.style.left = (pands.x + pands.size * 0.70) + "px";
        }
        else {
            previewDiv.style.left = "";
            previewDiv.style.right = (parentWidth - pands.x - pands.size * 0.30) + "px";
        }
        previewDiv.style.top = (pands.y + pands.size * 0.70) + "px";
    
        // content of the frame
        var table =  previewDiv.appendChild(document.createElement("table"));
        var maxToShow = 8;
    
        var bookings = this.getBookings();

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
        previewDiv.style.display = "block";
    });
    
    seatFactory.on( 'mouseout', function() {
        previewDiv.style.display = "none";  
    });

}

function initActionMenu(seatFactory) {

    var seat = null;    // used for passing seat to btn click events (closure)
                        // it is set at the end of seatFactory.on('click'
                        // it is used in actionBtn click event
                        // and it is reset (to release reference) in actionModal onCloseEnd event

    // init modal
    var actionEl = document.getElementById('action_modal');
    var actionModal =  M.Modal.init(actionEl, { onCloseEnd: function() {
        seat = null;    // release reference to the object
        }} );

    // register hooks
    var actionBtns = document.getElementsByClassName('zone_action_btn');

    seatFactory.on( 'click', function() {

        var state = this.getState();

        if (state == WarpSeat.SeatStates.TAKEN || state == WarpSeat.SeatStates.NOT_AVAILABLE)
            return;

        var actions = [];
        var bookMsg = false;
        var removeMsg = false;

        switch (this.getState()) {
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

        if (!actions.length)
            return;
        
        let msg1El = document.getElementById("action_modal_msg1");
        if (bookMsg) {

            msg1El.innerHTML = "";

            var bookDatesTable = document.createElement("table");
            for (let d of getSelectedDates()) {
                let f = WarpSeatFactory._formatDatePair(d);
                let tr = bookDatesTable.appendChild(document.createElement("tr"));
                tr.appendChild( document.createElement("td")).innerText = f.datetime1;
                tr.appendChild( document.createElement("td")).innerText = f.datetime2;
            }

            let p = document.createElement('P');
            p.innerText = "To be booked:";

            msg1El.appendChild(p);
            msg1El.appendChild(bookDatesTable);
            msg1El.style.display = "block";
        }
        else {
            msg1El.style.display = "none";
        }

        let msg2El = document.getElementById("action_modal_msg2");
        if (removeMsg) {
            
            msg2El.innerHTML = "";

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
            msg2El.style.display = "block";
        }
        else {
            msg2El.style.display = "none";
        }

        for (let btn of actionBtns) {
            if (actions.includes(btn.dataset.action))
                btn.style.display = "block";
            else
                btn.style.display = "none";
        }
    
        //var actionElTitle = document.getElementById('action_modal_title');
        //actionElTitle.innerText = "Seat: "+this.getName();

        seat = this;
        actionModal.open();
    });

    var actionBtnClicked = function(e) {
            
        var xhr = new XMLHttpRequest();    
        xhr.open("POST", zoneActionURL);
        xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
        xhr.addEventListener("load", function(e) {
            if (this.status == 200)
                M.toast({html: 'Action successfull.'});
            else
                WarpModal.getInstance().open("Change unsuccessfull","Unable to apply the change. Probably the seat was already booked by someone else.<br>Status: "+this.status);

            downloadSeatData(seatFactory);
        });

        xhr.send( JSON.stringify( {
            "action": this.dataset.action,
            "sid": seat.getSid(),
            "dates": getSelectedDates()
            }));
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
    restoredSelections = restoredSelections? JSON.parse(restoredSelections): defaultSelections;

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
        
        restoredSelections.cb = defaultSelections.cb;        
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

function initZone() {

    initSlider();
    initDateSelectorStorage();
    initShiftSelectDates();

    var seatFactory = initSeats();
    initSeatPreview(seatFactory);
    initActionMenu(seatFactory);

    downloadSeatData(seatFactory);
}

window.addEventListener("load",initZone);