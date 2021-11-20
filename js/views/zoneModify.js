"use strict";

import Utils from './modules/utils.js';
import WarpModal from './modules/modal.js';
import { SeatFactory, spriteSize} from './modules/zoneModify_seat.js';

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
        saveBtn.classList.remove('disabled');
    });

    let seatEditPanel = document.getElementById("seat_edit_panel");
    let seatNameEl = document.getElementById("seat_name");
    let seatXEl = document.getElementById("seat_x");
    let seatYEl = document.getElementById("seat_y");
    let seatDeleteBtn = document.getElementById('seat_delete_btn');

    let seatFactory = new SeatFactory(window.warpGlobals.URLs['zonesGetSeats'],zoneMapContainer,zoneMapImg);

    zoneMapImg.addEventListener('mousedown', function(e) {

        if (!addSeatState)
            return;

        var rect = zoneMapImg.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;
        seatFactory.createNewSeat(null,x,y);

        e.stopPropagation();
    });

    let seatDeleteBtnUpdate = function(seat) {
        if (seat.deleted) {
            seatDeleteBtn.innerText = TR('btn.Restore');
            seatDeleteBtn.classList.add('green');
            seatDeleteBtn.classList.remove('red','darken-2');
        }
        else {
            seatDeleteBtn.innerText = TR('btn.Delete');
            seatDeleteBtn.classList.remove('green');
            seatDeleteBtn.classList.add('red','darken-2');
        }
    }

    seatDeleteBtn.addEventListener('click', function(e) {
        let seat = seatFactory.getSelectedSeat();
        seatFactory.deleteRestoreSeat(seat);
        seatDeleteBtnUpdate(seat);
    });



    let transformBtn = document.getElementById('transform_btn');

    let transformBtnUpdate = function(seat) {
        if (seatFactory.transformState()) {
            transformBtn.classList.remove('disabled');
            transformBtn.classList.add('green');
            transformBtn.innerText = TR('btn.Finish alignment');


        }
        else {
            transformBtn.classList.remove('green');
            transformBtn.innerText = TR('btn.Align all');
            if (seat.isNew())
                transformBtn.classList.add('disabled');
            else
                transformBtn.classList.remove('disabled');
        }
    }

    transformBtn.addEventListener('click', function(e) {

        if (seatFactory.transformState())
            seatFactory.endTransform(false);
        else
            seatFactory.beginTransform(true);

        transformBtnUpdate(seatFactory.getSelectedSeat());
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

        var msg = TR("The following changes will be applied:<br>");
        if (data.has('image'))
            msg += TR("- updated zone map<br>");
        if ('remove' in json)
            msg += TR("- deleted %{smart_count} seat(s)<br>", {smart_count: json.remove.length });

        if ('addOrUpdate' in json) {
            let changed = 0;

            for (let i of json.addOrUpdate) {
                if ('sid' in i)
                    ++changed;
            }
            let added = json.addOrUpdate.length - changed;

            if (added > 0)
                msg += TR("- added %{smart_count} seat(s)<br>", {smart_count: added });
            if (changed > 0)
                msg += TR("- updated data of %{smart_count} seat(s)<br>", {smart_count: changed });
        }


        WarpModal.getInstance().open(
            TR("Are you sure to update the zone?"),
            msg,
            {
                buttons: [ {id: 1, text: TR("btn.Yes")}, {id: 0, text: TR("btn.No")} ],
                onButtonHook: function(btnId) {

                    if (btnId != 1)
                        return;

                    Utils.xhr.post(
                        window.warpGlobals.URLs['zonesModifyXHR'],
                        data)
                    .then( () => {
                        mapUploadInput.value = null;
                        seatFactory.updateData();
                    })
                },
            });
    });

    seatFactory.on('select', (seat) => {

        seatDeleteBtnUpdate(seat);
        transformBtnUpdate(seat);
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
        seatXEl.value = seat.x;
        seatYEl.value = seat.y;
    });

    seatFactory.on('change', (seat) => {
        if (seatFactory.isChanged())
            saveBtn.classList.remove('disabled');
        else
            saveBtn.classList.add('disabled');
    });


    let onBeforeUnload = function(e) {
        if (mapUploadInput.files.length > 0 || seatFactory.isChanged()) {
            e.preventDefault();
            e.returnValue = '';
        }
    }

    window.addEventListener('beforeunload', onBeforeUnload);

    let cancelBtn = document.getElementById('cancelBtn');
    cancelBtn.addEventListener('click', function(e) {

        let pageRet = function() {
            window.removeEventListener('beforeunload', onBeforeUnload);
            window.location.href = window.warpGlobals['returnURL'];
        };

        if (mapUploadInput.files.length > 0 || seatFactory.isChanged()) {
            WarpModal.getInstance().open(
                TR("Are you sure?"),
                TR("All unsaved changes will be lost."),
                {
                    buttons: [ {id: true, text: TR("btn.Yes")}, {id: false, text: TR("btn.No")} ],
                    onButtonHook: function(btnId) {
                        if (btnId)
                            pageRet();
                    }
                }
            );
        }
        else {
            pageRet();
        }
    });

    var changeFactory = function(prop) {
        return function(e) {
            let selSeat = seatFactory.getSelectedSeat();
            if (!selSeat)
                return;
            selSeat[prop] = e.target.value;
        }
    }

    seatNameEl.addEventListener('input', changeFactory('name'));
    seatXEl.addEventListener('input', changeFactory('x'));
    seatYEl.addEventListener('input', changeFactory('y'));

    var seatXYMax = function() {
        seatXEl.max = zoneMapImg.width - spriteSize;
        seatYEl.max = zoneMapImg.height - spriteSize;
    }

    if (zoneMapImg.complete)
        seatXYMax();
    zoneMapImg.addEventListener('load', seatXYMax);

    seatFactory.updateData();

});