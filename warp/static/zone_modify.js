"use strict";

document.addEventListener("DOMContentLoaded", function(e) {

    let chooseImgBtn = document.getElementById('chooseImgBtn');
    let mapUploadInput = document.getElementById('mapUploadInput');
    let saveBtn = document.getElementById('saveBtn');

    let zoneMapImg = document.getElementById('zone_map');
    let zoneMapContainer = document.getElementById('zone_map_container');

    let addSeatState = false;
    let addSeatBtn = document.getElementById('addSeatBtn');

    let updateAddSeatState = function() {
        if (addSeatState) {
            addSeatBtn.classList.add('green');
            addSeatBtn.innerText = TR("btn.Done adding");
        }
        else {
            addSeatBtn.classList.remove('green');
            addSeatBtn.innerText = TR("btn.Add seats");
        }
    };

    updateAddSeatState();

    document.getElementById('addSeatBtn').addEventListener('click', function(e) {
        addSeatState = !addSeatState;
        updateAddSeatState();
    });


    chooseImgBtn.addEventListener('click', function(e) {
        mapUploadInput.click();
    });

    mapUploadInput.addEventListener('change', function(e) {

        if (mapUploadInput.files.length != 1)
            return;

        zoneMapImg.src = URL.createObjectURL(mapUploadInput.files[0]);

    });

    let seatEditPanel = document.getElementById("seat_edit_panel");
    let seatNameEl = document.getElementById("seat_name");
    let seatXEl = document.getElementById("seat_x");
    let seatYEl = document.getElementById("seat_y");
    let seatDeleteBtn = document.getElementById('seat_delete_btn');

    let seatFactory = new SeatFactory(window.warpGlobals.URLs['zonesGetSeats'],zoneMapContainer,zoneMapImg);

    seatFactory.on('select', (seat) => {
        seatNameEl.value = seat.name;
        seatXEl.value = seat.x;
        seatYEl.value = seat.y;
        M.updateTextFields();
        seatEditPanel.style.visibility = "visible";
    });
    seatFactory.on('unselect', (seat) => {
        seatEditPanel.style.visibility = "hidden";
    });
    seatFactory.on('drag', (seat) => {
        console.log('drag');
        seatXEl.value = seat.x;
        seatYEl.value = seat.y;
    });

    zoneMapImg.addEventListener('mousedown', function(e) {
        if (!addSeatState)
            return;

        var rect = zoneMapImg.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;
        seatFactory.createNewSeat(null,x,y);

        e.stopPropagation();
    });

    seatDeleteBtn.addEventListener('click', function(e) {
        seatFactory.removeSelectedSeat();
    });

    saveBtn.addEventListener('click', function(e) {

        let json = {
            zid: window.warpGlobals.zid
        };

        let changed = false;
        let data = new FormData();

        if (mapUploadInput.files.length == 1) {
            data.append('image', mapUploadInput.files[0]);
            changed = true;
        }

        if (seatFactory.isChanged()) {
            Object.assign( json, seatFactory.getChanges() );
            changed = true;
        }

        if (!changed)
            return;

        data.append('json', JSON.stringify(json));

        Utils.xhr(
            window.warpGlobals.URLs['zonesModifyXHR'],
            data)
        .then( () => {
            seatFactory.updateData();
        })
        .catch( () => {
            seatFactory.updateData();
        });
    });

    seatFactory.updateData();

});