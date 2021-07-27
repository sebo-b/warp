
var seatData = {};
var seatElementMap = {};

function getSeatData(successHook) {

    var xhr = new XMLHttpRequest();
    xhr.addEventListener("load", function() {

        var resp = JSON.parse(this.responseText);
        if (typeof(successHook) == 'function')
            successHook(resp);
    });

    xhr.open("GET", getSeatURL);
    xhr.send();

}

function updateSeatData() {

    getSeatData( function(seatDataParam) {

        //create all missing divs
        for (var sid in seatDataParam) {
            v = seatDataParam[sid];
            if (!v.other_zone)
                createSeatElement(sid,seatDataParam[sid]);
        }

        if (Object.keys(seatElementMap).length != Object.keys(seatDataParam).length) {
            //remove all unnecesary divs
            for (var sid in seatElementMap) {
                if(!(sid in seatDataParam)) {
                    seatElementMap[sid].remove();
                    delete seatElementMap[sid];
                }
            }
        }
            
        seatData = seatDataParam;

        visualizeSeats();
    });

}

function initSlider(onChangeHook) {

    var sliderOnUpdate = function(values, handle, unencoded, tap, positions, noUiSlider) {
        var minDiv = document.getElementById('timeslider-min');
        var maxDiv = document.getElementById('timeslider-max');

        function f(v) {
            h = (v/3600 | 0).toString();
            m = (v%3600/60 | 0).toString();
            h = h.length < 2? "0" + h: h;
            m = m.length < 2? "0" + m: m;
            return h+":"+m;
        };

        minDiv.innerText = f(values[0]);
        maxDiv.innerText = f(values[1]);

        if (typeof(onChangeHook) == 'function')
            onChangeHook();
    };

    var slider = document.getElementById('timeslider');      

    noUiSlider.create(slider, {
        start: [9*3600, 17*3600],
        connect: true,
        behaviour: 'drag',
        step: 15*60,
        margin: 15*60,
        orientation: 'vertical',
        range: { 'min': 0, 'max': 24*3600 }
    });
    
    slider.noUiSlider.on('update', sliderOnUpdate);
}

function getSelectedDates() {
    var slider = document.getElementById('timeslider');
    var times = slider.noUiSlider.get(true);

    var res = [];

    for (e of document.getElementsByClassName('date_checkbox')) {
        if (e.checked) {
            res.push( {
                fromTS: parseInt(e.value) + parseInt(times[0]), 
                toTS: parseInt(e.value) + parseInt(times[1]) 
            });
        }
    };
    
    return res;
}

var seatAction = {
    NONE: 0,
    CAN_BOOK: 1,
    CAN_REBOOK: 2,
    CAN_CHANGE: 3,
    CAN_DELETE: 4,
    CAN_DELETE_EXACT: 5
};

function visualizeSeats() {

    if (Object.keys(seatData).length == 0)
        return;

    var dates = getSelectedDates();
    
    var anyIsMy = false;

    for (var seatId in seatData) {

        var seat = seatData[seatId];

        var isFree = true;
        var isMy = false;
        var isExact = 0;

        date_loop:
        for (var date of dates) {
            for (var book of seat['book']) {
                if ( book.fromTS >= date.toTS ) // book is sorted by fromTS
                    break;
                else if (book.toTS > date.fromTS) {
                    if (book.uid == uid) {
                        isMy = true;
                        anyIsMy = true;

                        if (book.fromTS == date.fromTS && book.toTS == date.toTS)
                            ++isExact;

                        if (!isFree)
                            break date_loop;
                    }
                    else {
                        isFree = false;
                        if (isMy)
                            break date_loop;
                    }
                }
            }
        }

        if (isMy) {

            isExact = (isExact == dates.length);

            if (isFree)
                seat['action'] = isExact? seatAction.CAN_DELETE_EXACT: seatAction.CAN_CHANGE;
            else
                seat['action'] = isExact? seatAction.CAN_DELETE_EXACT: seatAction.CAN_DELETE;
        }
        else {
            seat['action'] = isFree? seatAction.CAN_BOOK: seatAction.NONE;
        }
    }

    for (var seatId in seatData) {
        var seat = seatData[seatId];
        var seatElm = seatElementMap[seatId];

        if (!seatElm)
            continue;

        if (seat['action'] == seatAction.CAN_CHANGE) {
            seatElm.style.backgroundPositionX = visualizeSeats.seatSpriteData.user_rebook;
        }
        else if (seat['action'] == seatAction.CAN_DELETE_EXACT) {
            seatElm.style.backgroundPositionX = visualizeSeats.seatSpriteData.user_exact;
        }
        else if (seat['action'] == seatAction.CAN_DELETE) {
            seatElm.style.backgroundPositionX = visualizeSeats.seatSpriteData.user_conflict;
        }
        else if (seat['action'] == seatAction.CAN_BOOK) {
            if (anyIsMy) {
                seat['action'] = seatAction.CAN_REBOOK;
                seatElm.style.backgroundPositionX = visualizeSeats.seatSpriteData.rebook;
            }
            else {
                seatElm.style.backgroundPositionX = visualizeSeats.seatSpriteData.book;
            }
        }
        if (seat['action'] == seatAction.NONE) {
            seatElm.style.backgroundPositionX = visualizeSeats.seatSpriteData.conflict;
        }
    }
}

visualizeSeats.seatSpriteData = {
    SIZE: 48,
    book: "-144px",
    rebook: "-192px",
    conflict: "-240px",
    user_conflict: "-48px",
    user_exact: "0px",
    user_rebook: "-96px"
};

function seatOnClick(sid) {

    seat = seatData[sid];

    if (seat['action'] == seatAction.NONE)
        return;

    var actionEl = document.getElementById('action_modal');
    var actionElTitle = document.getElementById('action_modal_title');

    var modal = M.Modal.getInstance(actionEl);
    if (!modal) {
        modal = M.Modal.init(actionEl,{ onCloseEnd: function() {

            console.log("Clening");
            let actionBtnBook = document.getElementById('action_book_btn');
            let actionBtnUpdate = document.getElementById('action_update_btn');
            let actionBtnDelete = document.getElementById('action_delete_btn');
        
            actionBtnBook.parentNode.replaceChild(actionBtnBook.cloneNode(true), actionBtnBook);
            actionBtnUpdate.parentNode.replaceChild(actionBtnUpdate.cloneNode(true), actionBtnUpdate);
            actionBtnDelete.parentNode.replaceChild(actionBtnDelete.cloneNode(true), actionBtnDelete);
        }});
    }

    var actionBtnBook = document.getElementById('action_book_btn');
    var actionBtnUpdate = document.getElementById('action_update_btn');
    var actionBtnDelete = document.getElementById('action_delete_btn');

    if (seat['action'] == seatAction.CAN_BOOK) {
        actionBtnBook.addEventListener('click',actionClicked.bind(null,'book',sid))
        actionBtnBook.style.display = "block";
    }
    else
        actionBtnBook.style.display = "none";

    if (seat['action'] == seatAction.CAN_CHANGE || seat['action'] == seatAction.CAN_REBOOK) {
        actionBtnUpdate.addEventListener('click',actionClicked.bind(null,'update',sid))
        actionBtnUpdate.style.display = "block";
    }
    else
        actionBtnUpdate.style.display = "none";
    
    if (seat['action'] == seatAction.CAN_CHANGE || seat['action'] == seatAction.CAN_DELETE || seat['action'] == seatAction.CAN_DELETE_EXACT) {
        actionBtnDelete.addEventListener('click',actionClicked.bind(null,'delete',sid))
        actionBtnDelete.style.display = "block";
    }
    else
        actionBtnDelete.style.display = "none";

    actionElTitle.innerText = "Seat: "+seat.name;
    modal.open();
}

function fillOutPreviewDiv(previewDiv,seat) {

    previewDiv.innerHTML = "";

    var dates = getSelectedDates();

    var table =  document.createElement("table");
    var maxToShow = 8;

    function formatDatePair(fromTS,toTS) {

        var fromStr = new Date(fromTS*1000).toISOString();
        var toStr = new Date(toTS*1000).toISOString();

        if (fromStr.substring(0,10) == toStr.substring(0,10)) {
            return [
                fromStr.substring(0,10),
                fromStr.substring(11,16)+"-"+toStr.substring(11,16)
            ];
        }
        else {
            return [
                fromStr.substring(0,16).replace('T',' '),
                toStr.substring(0,16).replace('T',' ')
            ];
        }
    }


    date_loop:
    for (var date of dates) {
        for (var book of seat['book']) {
            if ( book.fromTS >= date.toTS ) // book is sorted by fromTS
                break;
            else if (book.toTS > date.fromTS) {
                var tr = table.appendChild( document.createElement("tr"));

                if (maxToShow-- <= 0) {
                    td = tr.appendChild( document.createElement("td"));
                    td.innerText = "...";
                    td = tr.appendChild( document.createElement("td"));
                    td = tr.appendChild( document.createElement("td"));
                    break date_loop;
                }
                else {
                    var dateStr = formatDatePair(book.fromTS,book.toTS);

                    td = tr.appendChild( document.createElement("td"));
                    td.innerText = dateStr[0];
                    td = tr.appendChild( document.createElement("td"));
                    td.innerText = dateStr[1];
                    td = tr.appendChild( document.createElement("td"));
                    td.innerText = book.username;
                }
            }
        }
    }

    previewDiv.appendChild( table);
}

function seatOnMouseOver(sid) {
    
    var seat = seatData[sid];

    switch (seat['action']) {
        case seatAction.CAN_BOOK:     
        case seatAction.CAN_REBOOK:     
        case seatAction.CAN_CHANGE:     
        case seatAction.CAN_DELETE_EXACT:   
            return;
    };

    previewDiv = document.getElementById('seat_preview');
    
    var parentWidth = previewDiv.parentNode.clientWidth

    var left =
        seat['x'] < parentWidth / 2;

    if (left) {
        previewDiv.style.right = "";
        previewDiv.style.left = (seat['x'] + visualizeSeats.seatSpriteData.SIZE * 0.60) + "px";
    }
    else {
        previewDiv.style.left = "";
        previewDiv.style.right = (parentWidth - seat['x'] - visualizeSeats.seatSpriteData.SIZE * 0.40) + "px";
    }
    previewDiv.style.top = (seat['y'] + visualizeSeats.seatSpriteData.SIZE * 0.60) + "px";

    fillOutPreviewDiv(previewDiv,seat);

    previewDiv.style.display = "block";
}

function seatOnMouseOut(sid) {
    previewDiv = document.getElementById('seat_preview');
    previewDiv.style.display = "none";  
}

function actionClicked(action,sid) {

    action_data = {
        "action": action,
        "sid": parseInt(sid),
        "dates": getSelectedDates()
    };

    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function () {
        if(xhr.readyState === XMLHttpRequest.DONE) {
            if (xhr.status === 0 || xhr.status == 200) {
                updateSeatData();
            }
            else {
                var resp = JSON.parse(xhr.responseText);
                alert('err: ' +resp.msg);
            }
        }
    };

    xhr.open("POST", zoneActionURL);
    xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
    xhr.send( JSON.stringify( action_data));
}

function createSeatElement(sid,seatDataEl) {
    
    if (sid in seatElementMap)
        return seatElementMap[sid];
    
    seatEl =  document.createElement("div");
    seatEl.style.position = "absolute";
    seatEl.style.left = seatDataEl['x'] + "px";
    seatEl.style.top = seatDataEl['y'] + "px";
    seatEl.style.width = "48px";    // also prevents reflow
    seatEl.style.height = "48px";
    seatEl.style.backgroundImage = 'url('+seatSpriteURL+')';

    parentEl = document.getElementById(dstId);
    parentEl.appendChild(seatEl);
    seatEl.addEventListener('click',seatOnClick.bind(null,sid));
    seatEl.addEventListener('mouseover',seatOnMouseOver.bind(null,sid));
    seatEl.addEventListener('mouseout',seatOnMouseOut.bind(null,sid));

    seatElementMap[sid] = seatEl;
}

function initZone(seatDataParam) {

    seatData = seatDataParam;

    target = document.getElementById(dstId);

    if (Object.values(seatData).lenght == 0)
        return;
    
    for (p in seatData) {
        v = seatData[p];
        if (!v.other_zone)
            createSeatElement(p,v)
    }

    for (e of document.getElementsByClassName('date_checkbox')) {
        e.addEventListener('change',visualizeSeats)
    }
    initSlider(visualizeSeats);

}

window.addEventListener("load",getSeatData.bind(null,initZone));