

document.addEventListener("DOMContentLoaded", function(e) {

    var dateFilterEditor = function(cell, onRendered, success, cancel, editorParams){

        var picker = document.createElement("input");

        var offset = 0;
        if (typeof(editorParams) === 'object'&& 'offset' in editorParams) {
            offset = editorParams['offset'];
        }

        var pickerOptions = {
            container: document.body,
            autoClose: true,
            showClearBtn: true,
            format: "yyyy-mm-dd",
            onClose: function() {
                success(picker.value? (Date.parse(picker.value)/1000+offset): null)
            }
        };

        M.Datepicker.init(picker, pickerOptions);

        return picker;
    }

    var tsFormatter = function(cell) {
        var data = cell.getValue();
        var ts = new Date(parseInt(data)*1000);

        return ts.toISOString().substring(0,16).replace('T',' ');
    }

    var mergedDateFilterEditor = function(cell, onRendered, success, cancel, editorParams){

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
                    toTS: toDatePicker.value? (Date.parse(toDatePicker.value)/1000+24*3600-1): null
                });
             }
        };

        M.Datepicker.init(fromDatePicker, pickerOptions);
        M.Datepicker.init(toDatePicker, pickerOptions);

        return container;
    }

    var mergedTsFormatter = function(cell) {
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

    var removeFormatter = function(cell, formatterParams) {
        if (cell.getRow().getData().rw)
            return '<div class="delete_icon"></div>'
        else
            return "";
    }

    var removeClicked = function(e,cell) {

        var data = cell.getRow().getData();
        var bid = data['id'];

        if (!data.rw)
            return;

        let modalBtnClicked = function(buttonId) {

            if (buttonId != 1)
                return;

            var action_data = { remove: [ bid ]};

            var xhr = new XMLHttpRequest();
            xhr.open("POST", window.warpGlobals.URLs['zoneApply'],true);
            xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
            xhr.addEventListener("load", function() {
                if (this.status == 200) {
                    cell.getTable().replaceData();
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
              "Time: "+mergedTsFormatter(cell);

        WarpModal.getInstance().open("Are you sure to delete this booking?",msg,modalOptions);
    }


    var columns = [
        {title:"Name", field: "user_name", headerFilter:"input", headerFilterFunc:"starts"},
        {title:"Zone", field: "zone_name", headerFilter:"input", headerFilterFunc:"starts"},
        {title:"Seat", field: "seat_name", headerFilter:"input", headerFilterFunc:"starts"}
    ];

    var initialSort = [];

    if (window.warpGlobals['report']) {

        columns.splice(1,0,
            {title:"Login", field: "login", headerFilter:"input", headerFilterFunc:"starts"}
        );

        columns.push(
            {title:"From", field: "fromTS", formatter:tsFormatter, headerFilter:dateFilterEditor, headerFilterFunc:">="},
            {title:"To", field: "toTS", formatter:tsFormatter, headerFilter:dateFilterEditor, headerFilterParams: { offset: 24*3600-1 }, headerFilterFunc:"<="}
        );

        initialSort.push(
            {column:"toTS", dir:"desc"},
            {column:"fromTS", dir:"desc"},
            {column:"login", dir:"asc"}
        );
    }
    else {
        columns.push(
            {title:"Time", field: "fromTS", width: 275,
                formatter:mergedTsFormatter,
                headerFilter:mergedDateFilterEditor,
                headerFilterFunc:function(){} },
        );

        columns.splice(0,0,
            {formatter:removeFormatter, width:40, hozAlign:"center", cellClick:removeClicked, headerSort:false}
        );

        initialSort.push(
            {column:"login", dir:"asc"},
            {column:"fromTS", dir:"asc"}
        );
    }

    var table = new Tabulator("#reportTable", {
        height: "3000px",   //this will be limited by maxHeight, we need to provide height
        maxHeight:"100%",   //to make paginationSize work correctly
        ajaxURL: window.warpGlobals.URLs['bookingsReport'],
        index:"id",
        layout:"fitDataFill",
        resizableColumns:true,
        pagination: 'remote',
        ajaxSorting:true,
        ajaxFiltering:true,
        ajaxConfig: "POST",
        ajaxContentType: "json",
        columns: columns,
        initialSort: initialSort
/*        persistence: {
            sort: true,
        },
        persistenceWriterFunc:persistenceWriterFunc,
        persistenceReaderFunc:persistenceReaderFunc
*/
    });

    if (window.warpGlobals['report']) {

        document.getElementById('export_btn').addEventListener('click', function(e) {


            let data = {
                export: "xlsx",
                filters: table.getHeaderFilters(),
                sorters: table.getSorters().map( (i) => { return { field: i.field, dir: i.dir} }  )
            }

            let xhr = new XMLHttpRequest();
            xhr.open("POST", window.warpGlobals.URLs['bookingsReport'],true);
            xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
            xhr.responseType = 'blob';
            xhr.addEventListener("load", function() {
                if (this.status == 200) {

                    let a = document.createElement("a");
                    a.href = window.URL.createObjectURL(this.response);

                    let m = this.getResponseHeader('Content-Disposition').match("filename=(.*)");
                    if (m != null)
                        a.download = m[1];

                    a.click();
                    window.URL.revokeObjectURL(a.href);
                }
                else
                    WarpModal.getInstance().open("Error","Something went wrong (status="+this.status+").");
                });

            xhr.send( JSON.stringify( data));
        });
    }

});