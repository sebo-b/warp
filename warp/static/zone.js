
var seatData = {};
var seatDivMap = {};

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
        for (var sid in seatDataParam)
            createSeatDiv(sid,seatDataParam[sid]);

        if (Object.keys(seatDivMap).length != Object.keys(seatDataParam).length) {
            //remove all unnecesary divs
            for (var sid in seatDivMap) {
                if(!(sid in seatDataParam)) {
                    seatDivMap[sid].remove();
                    delete seatDivMap[sid];
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
    CAN_CHANGE: 2,
    CAN_DELETE: 3,
    CAN_DELETE_EXACT: 4
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
        var isExact = true;

        book_loop:
        for (var bookId in seat['book']) {

            var book = seat['book'][bookId]

            for (var date of dates) {
                if ( book.fromTS < date.toTS && book.toTS > date.fromTS) {
                    if (book.uid == uid) {
                        isMy = true;
                        anyIsMy = true;

                        if (isExact && (book.fromTS != date.fromTS || book.toTS != date.toTS))
                            isExact = false;

                        if (!isFree)
                            break book_loop;
                    }
                    else {
                        isFree = false;
                        if (isMy)
                            break book_loop;
                    }
                }
            }
        }

        if (isMy) {

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
        var seatDiv = seatDivMap[seatId];

        if (!seatDiv)
            continue;

        if (seat['action'] == seatAction.CAN_CHANGE) {
            seatDiv.style.backgroundColor = "blue";
            seatDiv.style.borderColor = "green";
        }
        else if (seat['action'] == seatAction.CAN_DELETE_EXACT) {
            seatDiv.style.backgroundColor = "blue";
            seatDiv.style.borderColor = "blue";
        }
        else if (seat['action'] == seatAction.CAN_DELETE) {
            seatDiv.style.backgroundColor = "blue";
            seatDiv.style.borderColor = "red";
        }
        else if (seat['action'] == seatAction.CAN_BOOK) {
            if (anyIsMy) {
                seatDiv.style.backgroundColor = "green";
                seatDiv.style.borderColor = "blue";
            }
            else {
                seatDiv.style.backgroundColor = "green";
                seatDiv.style.borderColor = "green";
            }
        }
        if (seat['action'] == seatAction.NONE) {
            seatDiv.style.backgroundColor = "red";
            seatDiv.style.borderColor = "red";
        }
    }
}

function seatOnClick(sid) {

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

    var actionBtnBook = document.getElementById('action_book_btn').addEventListener('click',actionClicked.bind(null,'book',sid))
    var actionBtnUpdate = document.getElementById('action_update_btn').addEventListener('click',actionClicked.bind(null,'update',sid))
    var actionBtnDelete = document.getElementById('action_delete_btn').addEventListener('click',actionClicked.bind(null,'delete',sid))

    actionElTitle.innerText = "Seat: "+seatData[sid].name;
    modal.open();
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

function createSeatDiv(sid,seatDataEl) {
    
    if (sid in seatDivMap)
        return seatDivMap[sid];
    
    seatDiv =  document.createElement("div");
    seatDiv.style.position = "absolute";
    seatDiv.style.backgroundColor = "green";
    seatDiv.style.borderStyle = "solid";
    seatDiv.style.borderWidth = "3px";
    seatDiv.style.borderColor = "yellow";
    seatDiv.style.left = seatDataEl['x'] + "px";
    seatDiv.style.top = seatDataEl['y'] + "px";
    seatDiv.style.height = "50px";
    seatDiv.style.width = "50px";
    seatDiv.innerText = seatDataEl['name'];

    parentDiv = document.getElementById(dstId);
    parentDiv.appendChild(seatDiv);
    seatDiv.addEventListener('click',seatOnClick.bind(null,sid));

    seatDivMap[sid] = seatDiv;
}

function initZone(seatDataParam) {

    seatData = seatDataParam;

    target = document.getElementById(dstId);

    if (Object.values(seatData).lenght == 0)
        return;
    
    for (p in seatData) {
        createSeatDiv(p,seatData[p])
    }

    for (e of document.getElementsByClassName('date_checkbox')) {
        e.addEventListener('change',visualizeSeats)
    }
    initSlider(visualizeSeats);

}

window.addEventListener("load",getSeatData.bind(null,initZone));