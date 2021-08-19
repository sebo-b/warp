"use strict";

function initBooking() {

    var dateFilterEditor = function(cell, onRendered, success, cancel, editorParams){

        var container = document.createElement("span");

        function createPicker(placeholderText) {

            var picker = document.createElement("input");
            picker.style.marginRight = "4px";
            picker.style.width = "45%";
            picker.style.boxSizing = "border-box";
            picker.placeholder = placeholderText;

            return picker;
        }

        var fromDatePicker = container.appendChild( createPicker('From'));
        var toDatePicker = container.appendChild( createPicker('To'));

        var pickerOptions = {
            container: document.body,
            autoClose: true,
            showClearBtn: true,
            format: "yyyy-mm-dd",
            onClose: function() { 
                success({
                    fromTS: fromDatePicker.value? (Date.parse(fromDatePicker.value)/1000): null,
                    toTS: toDatePicker.value? (Date.parse(toDatePicker.value)/1000+24*3600): null
                });
             }
        };

        M.Datepicker.init(fromDatePicker, pickerOptions);
        M.Datepicker.init(toDatePicker, pickerOptions);
    
        return container;
    }

    var dateFilterFunction = function(headerValue, rowValue, rowData, filterParams){

        return (headerValue.fromTS === null || rowData.fromTS >= headerValue.fromTS) &&
                (headerValue.toTS === null || rowData.toTS <= headerValue.toTS);
    }


    var tsFormatter = function(cell) {
        var data = cell.getRow().getData();
        var fromTS = new Date(parseInt(data.fromTS)*1000);
        var toTS = new Date(parseInt(data.toTS)*1000);

        var res = 
            fromTS.toUTCString().substring(0,5)+
            fromTS.toISOString().substring(0,16).replace('T',' ')+
            '-'+
            toTS.toISOString().substring(11,16);

        return res;
    }

    var persistenceWriterFunc = function(id, type, data){
            var storage = window.sessionStorage;
            var storageData = storage.getItem("bookings");
    
            if (storageData)
                storageData = JSON.parse(storageData);
            else
                storageData = {};

            if (!(id in storageData))
                storageData[id] = {};

            storageData[id][type] = data;

            storage.setItem("bookings", JSON.stringify(storageData));
    }

    var persistenceReaderFunc = function(id, type){
            var storage = window.sessionStorage;
            var storageData = storage.getItem("bookings");

            if (storageData) {
                storageData = JSON.parse(storageData);
                if (id in storageData && type in storageData[id]) {
                    return storageData[id][type];
                }
            }

            return false;
    }

    var removeFormatter = function(cell, formatterParams) {
        if (cell.getRow().getData().can_edit)
            return '<i class="material-icons-outlined">delete_forever</i>';
        else
            return "";
    }

    var removeClicked = function(e,cell) {

        var data = cell.getRow().getData();
        var bid = data['bid'];

        if (!data.can_edit)
            return;

        let modalBtnClicked = function(buttonId) {

            if (buttonId != 1)
                return;
    
            var action_data = { remove: [ bid ]};
            
            var xhr = new XMLHttpRequest();
            xhr.open("POST", zoneApplyURL,true);
            xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
            xhr.addEventListener("load", function() {
                if (this.status == 200) {
                    cell.getTable().deleteRow(bid)
                    M.toast({html: 'Action successfull.'});
                }
                else
                    WarpModal.getInstance().open("Error","Something went wrong (status="+this.status+").");
                });
        
            xhr.send( JSON.stringify( action_data));
        };
    
        var modalOptions = {
            buttons: [
                {id: 1, text: "YES"},
                {id: 0, text: "NO"}
            ],
            onButtonHook: modalBtnClicked
        }
    
        var msg = "User: "+data['user_name']+"<br>"+
              "Zone: "+data['zone_name']+"<br>"+
              "Seat: "+data['seat_name']+"<br>"+
              "Time: "+tsFormatter(cell);
    
        WarpModal.getInstance().open("Are you sure to delete this booking?",msg,modalOptions);
    }

    var table = new Tabulator("#bookingsTable", {
        maxHeight:"95%",
        ajaxURL: bookingsGetURL,
        index:"bid",
        layout:"fitColumns",
        resizableColumns:true,
        columns:[
            {title:"Name", field: "user_name", headerFilter:"input"},
            {title:"Zone", field: "zone_name", headerFilter:"input"},
            {title:"Seat", field: "seat_name", headerFilter:"input"},
            {title:"Time", field: "fromTS", width: 275, formatter:tsFormatter, headerFilter:dateFilterEditor, headerFilterFunc:dateFilterFunction},
            {formatter:removeFormatter, width:40, hozAlign:"center", cellClick:removeClicked, headerSort:false},
        ],
        //initialHeaderFilter:[
        //    {field:"login", value:"xxx"}
        //],        
        initialSort:[
            {column:"login", dir:"asc"},
            {column:"fromTS", dir:"asc"}
        ],
        persistence: {
            sort: true,
        },
        persistenceWriterFunc:persistenceWriterFunc,
        persistenceReaderFunc:persistenceReaderFunc
    });

}

window.addEventListener("load",initBooking)