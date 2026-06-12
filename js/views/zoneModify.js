"use strict";

import Utils from './modules/utils.js';
import WarpModal from './modules/modal.js';
import { SeatFactory, spriteSize} from './modules/zoneModify_seat.js';
import { MarqueeController } from './modules/zoneModify_marquee.js';
import { TransformController } from './modules/zoneModify_transform.js';

document.addEventListener("DOMContentLoaded", function(e) {

    let chooseImgBtn = document.getElementById('chooseImgBtn');
    let mapUploadInput = document.getElementById('mapUploadInput');
    let saveBtn = document.getElementById('saveBtn');

    let zoneMapImg = document.getElementById('zone_map');
    let zoneMapContainer = document.getElementById('zone_map_container');

    let modeSwitch = document.getElementById('modeSwitch');
    let editMode = true;

    let seatEditPanel = document.getElementById("seat_edit_panel");
    let seatNameEl = document.getElementById("seat_name");
    let seatXEl = document.getElementById("seat_x");
    let seatYEl = document.getElementById("seat_y");
    let seatDeleteBtn = document.getElementById('seat_delete_btn');

    let seatFactory = new SeatFactory(window.warpGlobals.URLs['zonesGetSeats'],zoneMapContainer,zoneMapImg);
    let marquee = new MarqueeController(zoneMapContainer, spriteSize);
    let transform = null;

    let showMarquee = () => {
        if (!editMode)
            return;
        let transformSeats = seatFactory.getTransformSeats();
        if (transformSeats.length > 0)
            marquee.show(transformSeats);
    };

    let resetCursor = () => {
        zoneMapContainer.style.cursor = '';
    };

    modeSwitch.addEventListener('change', function(e) {
        editMode = !modeSwitch.checked;

        if (!editMode) {
            marquee.hide();
            seatFactory.clearSelection();
            seatEditPanel.style.visibility = "hidden";
        }
        else {
            showMarquee();
        }
        resetCursor();
    });

    modeSwitch.checked = !editMode;
    resetCursor();

    zoneMapImg.addEventListener('mousedown', function(e) {

        if (editMode)
            return;

        let rect = zoneMapImg.getBoundingClientRect();
        let x = e.clientX - rect.left;
        let y = e.clientY - rect.top;
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

    chooseImgBtn.addEventListener('click', function(e) {
        mapUploadInput.click();
    });

    mapUploadInput.addEventListener('change', function(e) {

        if (mapUploadInput.files.length != 1)
            return;

        zoneMapImg.src = URL.createObjectURL(mapUploadInput.files[0]);
        saveBtn.classList.remove('disabled');
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
                        data,
                        {toastOnSuccess: false})
                    .then( () => {
                        window.sessionStorage.setItem('pendingToast', TR('Action successfull.'));
                        window.removeEventListener('beforeunload', onBeforeUnload);
                        window.location.href = window.warpGlobals['returnURL'];
                    })
                },
            });
    });

    seatFactory.on('select', (seat) => {

        if (transform) {
            transform.end();
            transform = null;
            marquee.hideRotateGuide();
        }
        if (editMode)
            showMarquee();
        seatDeleteBtnUpdate(seat);
        seatNameEl.value = seat.name;
        seatXEl.value = seat.x;
        seatYEl.value = seat.y;
        M.updateTextFields();
        seatEditPanel.style.visibility = "visible";
    });

    seatFactory.on('unselect', (seat) => {
        seatEditPanel.style.visibility = "hidden";
        if (editMode)
            showMarquee();
    });

    seatFactory.on('drag', (seat) => {
        seatXEl.value = seat.x;
        seatYEl.value = seat.y;

        if (marquee.active)
            marquee.update(seatFactory.getTransformSeats());
    });

    seatFactory.on('change', (seat) => {
        if (seatFactory.isChanged())
            saveBtn.classList.remove('disabled');
        else
            saveBtn.classList.add('disabled');

        if (marquee.active)
            marquee.update(seatFactory.getTransformSeats());
    });

    seatFactory.on('init', () => {
        showMarquee();
    });

    let beginTransform = (handle, x, y) => {

        if (!editMode || !marquee.active)
            return;

        let rect = zoneMapImg.getBoundingClientRect();
        let transformSeats = seatFactory.getTransformSeats();
        if (transformSeats.length === 0)
            return;

        transform = new TransformController(rect.width, rect.height, spriteSize);
        transform.begin(handle, transformSeats, seatFactory.getSelectedSeat(), x, y);

        if (handle === 'rotate') {
            marquee.showRotateGuide(transform.pivot, x, y, 0);
            zoneMapContainer.style.cursor = 'grabbing';
        }
    };

    let isSeatAt = (x, y) => seatFactory.seatAt(x, y) !== null;

    // Capture-phase: must run before SeatFactory's mousedown so we can suppress
    // the deselect when the user grabs the marquee box (which sits over seats).
    let containerMousedownCapture = (e) => {

        seatFactory.suppressDeselect = false;

        if (!editMode || !marquee.active)
            return;

        let rect = zoneMapImg.getBoundingClientRect();
        let x = e.clientX - rect.left;
        let y = e.clientY - rect.top;

        if (marquee.getHandleAt(x, y) === 'box')
            seatFactory.suppressDeselect = true;
    };

    // Bubble-phase: handle/rotate clicks come through marquee.onHandleMouseDown
    // (those stopPropagation), so only the 'box' hit reaches us here.
    let containerMousedown = (e) => {

        if (!editMode || !marquee.active)
            return;

        let rect = zoneMapImg.getBoundingClientRect();
        let x = e.clientX - rect.left;
        let y = e.clientY - rect.top;

        if (marquee.getHandleAt(x, y) === 'box') {
            e.preventDefault();
            beginTransform('box', x, y);
        }
    };

    let updateHoverCursor = (e) => {

        if (transform)
            return;

        let rect = zoneMapImg.getBoundingClientRect();
        let x = e.clientX - rect.left;
        let y = e.clientY - rect.top;

        if (!editMode) {
            zoneMapContainer.style.cursor = isSeatAt(x, y) ? 'cell' : 'copy';
            return;
        }

        if (isSeatAt(x, y))
            zoneMapContainer.style.cursor = 'cell';
        else if (marquee.active && marquee.getHandleAt(x, y) === 'box')
            zoneMapContainer.style.cursor = 'move';
        else
            zoneMapContainer.style.cursor = '';
    };

    let containerMousemove = (e) => {

        if (!transform)
            return;

        let rect = zoneMapImg.getBoundingClientRect();
        let x = e.clientX - rect.left;
        let y = e.clientY - rect.top;

        transform.drag(x, y);

        if (transform.handle === 'rotate')
            marquee.updateRotateGuide(transform.pivot, x, y, transform.lastAngle);
        else
            marquee.update(seatFactory.getTransformSeats());

        saveBtn.classList.remove('disabled');
    };

    let containerMouseup = (e) => {
        if (transform) {
            let wasRotate = transform.handle === 'rotate';
            transform.end();
            transform = null;
            if (wasRotate) {
                marquee.hideRotateGuide();
                showMarquee();
                resetCursor();
            }
        }
    };

    marquee.onHandleMouseDown(beginTransform);

    zoneMapContainer.addEventListener('mousedown', containerMousedownCapture, true);
    zoneMapContainer.addEventListener('mousedown', containerMousedown);
    zoneMapContainer.addEventListener('mousemove', updateHoverCursor);
    window.addEventListener('mousemove', containerMousemove);
    window.addEventListener('mouseup', containerMouseup);

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
