

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

    var table = new Tabulator("#reportTable", {
        height: "3000px",   //this will be limited by maxHeight, we need to provide height 
        maxHeight:"100%",   //to make paginationSize work correctly
        ajaxURL: window.warpGlobals.URLs['bookingsReport'],
        index:"bid",
        layout:"fitDataFill",
        resizableColumns:true,
        pagination: 'remote',
        ajaxSorting:true,
        ajaxFiltering:true,
        ajaxConfig: "POST",
        ajaxContentType: "json",
        columns:[
            {title:"Name", field: "user_name", headerFilter:"input", headerFilterFunc:"starts"},
            {title:"Login", field: "login", headerFilter:"input", headerFilterFunc:"starts"},
            {title:"Zone", field: "zone_name", headerFilter:"input", headerFilterFunc:"starts"},
            {title:"Seat", field: "seat_name", headerFilter:"input", headerFilterFunc:"starts"},
            {title:"From", field: "fromTS", formatter:tsFormatter, headerFilter:dateFilterEditor, headerFilterFunc:">="},
            {title:"To", field: "toTS", formatter:tsFormatter, headerFilter:dateFilterEditor, headerFilterParams: { offset: 24*3600-1 }, headerFilterFunc:"<="},
        ],      
        initialSort:[
            {column:"toTS", dir:"desc"},
            {column:"fromTS", dir:"desc"},
            {column:"login", dir:"asc"}
        ]
    });

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

});