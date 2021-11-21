
import Utils from './modules/utils.js';
import WarpModal from './modules/modal.js';
import {TabulatorFull as Tabulator} from 'tabulator-tables';
import "./css/tabulator/tabulator_materialize.scss";

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
                success(picker.value? Math.round(Date.parse(picker.value)/1000)+offset: null)
            }
        };

        if (warpGlobals.i18n.datePicker) {
            pickerOptions.firstDay = warpGlobals.i18n.datePicker.firstDay;
            pickerOptions.i18n = warpGlobals.i18n.datePicker.i18n_object;
        }

        M.Datepicker.init(picker, pickerOptions);

        let cellValue = cell.getValue();
        if (cellValue) {
            let ts = new Date(parseInt(cellValue)*1000);
            picker.value = ts.toISOString().substring(0,10);
        }

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

        var fromDatePicker = container.appendChild( createPicker(TR('From')));
        var toDatePicker = container.appendChild( createPicker(TR('To')));

        var pickerOptions = {
            container: document.body,
            autoClose: true,
            showClearBtn: true,
            format: "yyyy-mm-dd",
            onClose: function() {
                success({
                    fromTS: fromDatePicker.value? Math.round(Date.parse(fromDatePicker.value)/1000): null,
                    toTS: toDatePicker.value? Math.round(Date.parse(toDatePicker.value)/1000)+24*3600-1: null
                });
             }
        };

        if (warpGlobals.i18n.datePicker) {
            pickerOptions.firstDay = warpGlobals.i18n.datePicker.firstDay;
            pickerOptions.i18n = warpGlobals.i18n.datePicker.i18n_object;
        }

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
            return '<i class="material-icons red-text text-darken-3">delete_forever</i>';
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

            Utils.xhr.post(
                window.warpGlobals.URLs['zoneApply'],
                { remove: [ bid ]}
            ).then( () => {
                cell.getTable().replaceData();
            })

        };

        var modalOptions = {
            buttons: [
                {id: 1, text: TR("btn.Yes")},
                {id: 0, text: TR("btn.No")}
            ],
            onButtonHook: modalBtnClicked
        }

        var msg = TR('User name')+": "+data['user_name']+"<br>"+
              TR("Zone")+": "+data['zone_name']+"<br>"+
              TR("Seat")+": "+data['seat_name']+"<br>"+
              TR("Time")+": "+mergedTsFormatter(cell);

        WarpModal.getInstance().open(TR("Are you sure to delete this booking?"),msg,modalOptions);
    }


    var columns = [
        {title:TR("User name"), field: "user_name", headerFilter:"input", headerFilterFunc:"starts"},
        {title:TR("Zone"), field: "zone_name", headerFilter:"input", headerFilterFunc:"starts"},
        {title:TR("Seat"), field: "seat_name", headerFilter:"input", headerFilterFunc:"starts"}
    ];

    var initialSort = [];
    var initialHeaderFilter = [];

    if (window.warpGlobals['report']) {

        columns.splice(1,0,
            {title:TR("Login"), field: "login", headerFilter:"input", headerFilterFunc:"starts"}
        );

        columns.push(
            {title:TR("From"), field: "fromTS", formatter:tsFormatter, headerFilter:dateFilterEditor, headerFilterFunc:">="},
            {title:TR("To"), field: "toTS", formatter:tsFormatter, headerFilter:dateFilterEditor, headerFilterParams: { offset: 24*3600-1 }, headerFilterFunc:"<="}
        );

        initialSort.push(
            {column:"toTS", dir:"desc"},
            {column:"fromTS", dir:"desc"},
            {column:"login", dir:"asc"}
        );

        let todayTS = new Date();
        todayTS = Math.round(todayTS / 1000) - todayTS.getTimezoneOffset()*60;
        todayTS -= todayTS % (24*3600);
        let twoWeeksAgo = todayTS - 14*24*3600;

        initialHeaderFilter.push(
            {field:"fromTS", value: twoWeeksAgo},
            {field:"toTS", value: todayTS-1}
        );

    }
    else {
        columns.push(
            {title:TR("Time"), field: "fromTS", width: 275,
                formatter:mergedTsFormatter,
                headerFilter:mergedDateFilterEditor,
                headerFilterFunc:function(){} },
        );

        columns.splice(0,0,
            {formatter:removeFormatter, width:40, hozAlign:"center", cellClick:removeClicked, headerSort:false}
        );

        initialSort.push(
            {column:"fromTS", dir:"asc"},
            {column:"user_name", dir:"asc"}
        );
    }

    var table = new Tabulator("#reportTable", {
        height: "3000px",   //this will be limited by maxHeight, we need to provide height
        maxHeight:"100%",   //to make paginationSize work correctly
        ajaxURL: window.warpGlobals.URLs['bookingsReport'],
        index:"id",
        layout:"fitDataFill",
        langs: warpGlobals.i18n.tabulatorLangs,
        columnDefaults:{
            resizable:true,
        },
        pagination:true,
        paginationMode:"remote",
        sortMode:"remote",
        filterMode:"remote",
        ajaxConfig: "POST",
        ajaxContentType: "json",
        columns: columns,
        initialSort: initialSort,
        initialHeaderFilter: initialHeaderFilter
/*        persistence: {
            sort: true,
        },
        persistenceWriterFunc:persistenceWriterFunc,
        persistenceReaderFunc:persistenceReaderFunc
*/
    });

    if (window.warpGlobals['report']) {

        document.getElementById('export_btn').addEventListener('click', function(e) {

            let doExport = function() {

                let data = {
                    export: "xlsx",
                    filters: table.getHeaderFilters(),
                    sorters: table.getSorters().map( (i) => { return { field: i.field, dir: i.dir} }  )
                }

                Utils.xhr.post(
                    window.warpGlobals.URLs['bookingsReport'],
                    data,
                    {toastOnSuccess: false})
                .then(function(value) {
                    let a = document.createElement("a");
                    a.href = window.URL.createObjectURL(value.response);

                    let m = value.requestObject.getResponseHeader('Content-Disposition').match("filename=(.*)");
                    if (m != null)
                        a.download = m[1];

                    a.click();
                    window.URL.revokeObjectURL(a.href);
                });
            };

            let noOfRows = table.modules.page.size*table.modules.page.max;
            let maxRows = window.warpGlobals['maxReportRows'];
            if (noOfRows > maxRows) {
                WarpModal.getInstance().open(
                    TR("Warning"),
                    TR("More than %{smart_count} rows are selected. Report will be limited to that number of rows.",{smart_count: maxRows}),
                    { onButtonHook: () => {
                        doExport();
                        }
                    }
                );
            }
            else {
                doExport();
            }

        });
    }

});