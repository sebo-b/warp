"use strict";

var g_seatFactory;  //TODO get rid of a global variable

function downloadSeatData() {

    var xhr = new XMLHttpRequest();
    xhr.addEventListener("load", function() {

        var seatData = JSON.parse(this.responseText);

        g_seatFactory.setSeatsData(seatData);
        g_seatFactory.updateAllStates( getSelectedDates());
    });

    xhr.open("GET", getSeatURL);
    xhr.send();
}

function getSelectedDates() {
    var slider = document.getElementById('timeslider');
    var times = slider.noUiSlider.get(true);

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
        start: [9*3600, 17*3600],
        connect: true,
        behaviour: 'drag',
        step: 15*60,
        margin: 15*60,
        orientation: 'vertical',
        range: { 'min': 0, 'max': 24*3600-1 }
    });

    var minDiv = document.getElementById('timeslider-min');
    var maxDiv = document.getElementById('timeslider-max');
    slider.noUiSlider.on('update', function(values, handle, unencoded, tap, positions, noUiSlider) {
        minDiv.innerText = new Date(unencoded[0]*1000).toISOString().substring(11,16)
        maxDiv.innerText = new Date(unencoded[1]*1000).toISOString().substring(11,16)
    });

    return slider;
}

function initSeats() {

    g_seatFactory = new WarpSeatFactory(seatSpriteURL,"zonemap",uid);

    // register WarpSeats for updates
    var updateSeatsView = function() {
        var dates = getSelectedDates();
        g_seatFactory.updateAllStates(dates);
    }

    var slider = document.getElementById('timeslider');
    slider.noUiSlider.on('update', updateSeatsView);

    for (var e of document.getElementsByClassName('date_checkbox')) {
        e.addEventListener('change',updateSeatsView);
    }
}

function initSeatPreview() {

    var previewDiv = document.getElementById('seat_preview');

    g_seatFactory.on( 'mouseover', function() {
    
        switch (this.getState()) {
            case WarpSeat.SeatStates.CAN_BOOK:
            case WarpSeat.SeatStates.CAN_REBOOK:
            case WarpSeat.SeatStates.CAN_DELETE_EXACT:
            case WarpSeat.SeatStates.DISABLED:
                return;
        };
    
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
                b.user = "";
            }

            var tr = table.appendChild( document.createElement("tr"));
            tr.appendChild( document.createElement("td")).innerText = b.datetime1;
            tr.appendChild( document.createElement("td")).innerText = b.datetime2;
            tr.appendChild( document.createElement("td")).innerText = b.user;

            if (maxToShow == 0)
                break;
        }
        previewDiv.style.display = "block";
    });
    
    g_seatFactory.on( 'mouseout', function() {
        previewDiv.style.display = "none";  
    });

}

function initActionMenu() {

    var seat = null;    // used for passing seat to btn click events (closure)
                        // it is set at the end of g_seatFactory.on('click'
                        // it is used in actionBtn click event
                        // and it is reset (to release reference) in actionModal onCloseEnd event

    // init modal
    var actionEl = document.getElementById('action_modal');
    var actionModal =  M.Modal.init(actionEl, { onCloseEnd: function() {
        seat = null;    // release reference to the object
        }} );

    // register hooks
    var actionBtns = document.getElementsByClassName('zone_action_btn');

    var actionElTitle = document.getElementById('action_modal_title');

    g_seatFactory.on( 'click', function() {

        var state = this.getState();

        // todo - admin actions
        if (state == WarpSeat.SeatStates.TAKEN || state == WarpSeat.SeatStates.DISABLED)
            return;

        var actions = [];
        switch (this.getState()) {
            case WarpSeat.SeatStates.CAN_BOOK:
                actions.push('book');
                // Seat XXX will be booked for the following period(s): ...
                break;
            case WarpSeat.SeatStates.CAN_CHANGE:
                actions.push('delete');
                // no break here
            case WarpSeat.SeatStates.CAN_REBOOK:
                actions.push('update');
                // Seat XXX will be booked for the following period(s): ... 
                // The following booking(s) will be released: ....
                break;
            case WarpSeat.SeatStates.CAN_DELETE:
            case WarpSeat.SeatStates.CAN_DELETE_EXACT:
                actions.push('delete');
                // The following booking(s) will be released: ....
                break;
        };

        if (!actions.length)
            return;
        
        for (let btn of actionBtns) {
            if (actions.includes(btn.dataset.action))
                btn.style.display = "block";
            else
                btn.style.display = "none";
        }
    
        actionElTitle.innerText = "Seat: "+this.getName();

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

            downloadSeatData();
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

function initZone() {

    initSlider();
    initSeats();
    initSeatPreview();
    initActionMenu();

    downloadSeatData();
}

window.addEventListener("load",initZone);