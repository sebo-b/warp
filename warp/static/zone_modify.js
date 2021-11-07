"use strict";

document.addEventListener("DOMContentLoaded", function(e) {

    let mapUploadBtn = document.getElementById('mapUploadBtn');
    let saveBtn = document.getElementById('saveBtn');
    let tmpImg = document.getElementById('tmpImg');

    mapUploadBtn.addEventListener('change', function(e) {

        if (mapUploadBtn.files.length != 1)
            return;

        tmpImg.src = URL.createObjectURL(mapUploadBtn.files[0]);

    });

    saveBtn.addEventListener('click', function(e) {

        if (mapUploadBtn.files.length != 1)
            return;

        let tmpJson = {
            zid: window.warpGlobals.zid,
/*            addOrUpdate: [
                {name: "new 0.3",x:10,y:60},
                {name: "new 0.4",x:10,y:90},
                {name: "new 0.5",x:10,y:100},
                {sid: 1, x: 50, name: "upd 1.1"}
            ]*/
        };

        let data = new FormData();
        data.append('image', mapUploadBtn.files[0]);
        data.append('json', JSON.stringify(tmpJson));

        Utils.xhr(
            window.warpGlobals.URLs['zonesModifyXHR'],
            data
        );
    });

});