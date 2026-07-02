"use strict";

import html from './html/bookings.html';
import Utils from './modules/utils.js';
import WarpModal from './modules/modal.js';
import { createTable } from '../lib/tablePage.js';
import { M } from '../app/materialize.js';
import { timestampFormatter } from '../lib/formatters.js';

export { html };

export async function mount(ctx) {
    const root = ctx.root;
    const report = !!ctx.meta.report;

    var dateFilterEditor = function(cell, onRendered, success, cancel, editorParams){

        // Wrap the input in a span and return the span: Tabulator binds its
        // live-filter keyup/search handlers to the returned element, so binding
        // them to the inert span stops it submitting the raw "yyyy-mm-dd" string
        // as the filter value (which crashed the server's integer fromts/tots
        // comparison). success() is driven by onSelect + the change handler below.
        var container = document.createElement("span");
        var picker = container.appendChild(document.createElement("input"));

        var offset = 0;
        if (typeof(editorParams) === 'object'&& 'offset' in editorParams) {
            offset = editorParams['offset'];
        }

        var pickerOptions = {
            container: document.body,
            // Materialize 2.x defaults the calendar to an inline "docked" widget
            // placed before the input — unusable inside a tiny Tabulator header
            // cell. 'modal' restores the 1.x full-overlay calendar (opens on
            // input focus/click; inst.open() is deprecated in 2.x).
            displayPlugin: 'modal',
            autoClose: true,
            showClearBtn: true,
            format: "yyyy-mm-dd",
            onSelect: function(selectedDate) {
                // 2.x's setSingleDate never writes the input's .value on selection,
                // so read the selectedDate arg (a Date) instead of picker.value.
                success(selectedDate ? Math.round(selectedDate.getTime()/1000)+offset : null)
            }
        };

        if (warpGlobals.i18n.datePicker) {
            pickerOptions.firstDay = warpGlobals.i18n.datePicker.firstDay;
            pickerOptions.i18n = warpGlobals.i18n.datePicker.i18n_object;
        }

        // Materialize 2.x's Datepicker._insertHTMLIntoDOM reads el.parentNode, so it
        // must run AFTER Tabulator has inserted the input into the header cell.
        // Initialising eagerly (as in 1.x) throws "null querySelector", which aborts
        // column init — breaking the whole report. Defer to Tabulator's onRendered.
        onRendered(function() {
            M.Datepicker.init(picker, pickerOptions);

            let cellValue = cell.getValue();
            if (cellValue) {
                let ts = new Date(parseInt(cellValue)*1000);
                picker.value = ts.toISOString().substring(0,10);
            }

            // 2.x's clear button (and manual edits) fire `change` without
            // onSelect; re-derive the timestamp from the datepicker instance's
            // .date (null when cleared) so success always gets an integer.
            picker.addEventListener('change', function() {
                var inst = M.Datepicker.getInstance(picker);
                success(inst && inst.date ? Math.round(inst.date.getTime()/1000)+offset : null);
            });
        });

        return container;
    }

    var tsFormatter = timestampFormatter;

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

        var fromTS = null, toTS = null;
        var pickerOptions = {
            container: document.body,
            displayPlugin: 'modal',
            autoClose: true,
            showClearBtn: true,
            format: "yyyy-mm-dd",
            onSelect: function(selectedDate) {
                if (this.el === fromDatePicker) {
                    fromTS = selectedDate ? Math.round(selectedDate.getTime()/1000) : null;
                } else if (this.el === toDatePicker) {
                    toTS = selectedDate ? Math.round(selectedDate.getTime()/1000)+24*3600-1 : null;
                }
                success({ fromTS: fromTS, toTS: toTS });
            }
        };

        if (warpGlobals.i18n.datePicker) {
            pickerOptions.firstDay = warpGlobals.i18n.datePicker.firstDay;
            pickerOptions.i18n = warpGlobals.i18n.datePicker.i18n_object;
        }

        onRendered(function() {
            M.Datepicker.init(fromDatePicker, pickerOptions);
            M.Datepicker.init(toDatePicker, pickerOptions);

            fromDatePicker.addEventListener('change', function() {
                var inst = M.Datepicker.getInstance(fromDatePicker);
                fromTS = (inst && inst.date) ? Math.round(inst.date.getTime()/1000) : null;
                success({ fromTS: fromTS, toTS: toTS });
            });
            toDatePicker.addEventListener('change', function() {
                var inst = M.Datepicker.getInstance(toDatePicker);
                toTS = (inst && inst.date) ? Math.round(inst.date.getTime()/1000)+24*3600-1 : null;
                success({ fromTS: fromTS, toTS: toTS });
            });
        });

        return container;
    }

    var mergedTsFormatter = function(cell) {
        var data = cell.getRow().getData();
        var fromTS = new Date(parseInt(data.fromTS)*1000);
        var toTS = new Date(parseInt(data.toTS)*1000);

        var res =
            TR(`weekdaysShort.${fromTS.getDay()}`)+
            ', '+
            fromTS.toISOString().substring(0,16).replace('T',' ')+
            '-'+
            toTS.toISOString().substring(11,16);

        return res;
    }

    var removeFormatter = function(cell, formatterParams) {
        if (cell.getRow().getData().rw)
            return '<i class="material-icons warp-icon-danger">delete_forever</i>';
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
                window.warpGlobals.URLs['planApply'],
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
              TR("Plan")+": "+data['plan_name']+"<br>"+
              TR("Seat")+": "+data['seat_name']+"<br>"+
              TR("Time")+": "+mergedTsFormatter(cell);

        WarpModal.getInstance().open(TR("Are you sure to delete this booking?"),msg,modalOptions);
    }

    // Custom header filter for "User name" (non-report view only):
    //   - defaults to the logged-in user's own bookings via an EXACT login
    //     match (immune to name-prefix collisions like "User 1" vs "User 10"),
    //     with the login shown in the box; the login filter is applied here at
    //     column init (before the first data load), so the first request is
    //     already filtered (no unfiltered flash / double load);
    //   - ANY edit the user makes (including clearing) flips it to the regular
    //     starts-with name filter; an empty box then shows everyone.
    var userNameFilterEditor = function(cell, onRendered, success, cancel, editorParams) {
        var myLogin = window.warpGlobals['login'] || "";
        var myName = window.warpGlobals['userName'] || "";

        var container = document.createElement("span");
        var input = container.appendChild(document.createElement("input"));
        input.type = "search";
        input.style.width = "100%";
        input.style.boxSizing = "border-box";

        var v = cell.getValue();
        var inNameMode = (v && typeof v === "object" && typeof v.name === "string");
        input.value = inNameMode ? v.name : (myName || myLogin);

        onRendered(function() {
            if (myLogin && !inNameMode) {
                success({ login: myLogin });
            }
            var submit = function() { success({ name: input.value }); };
            input.addEventListener("input", submit);
            input.addEventListener("search", submit);
        });

        return container;
    };

    var userNameColumn = report
        ? {title:TR("User name"), field:"user_name", headerFilter:"input", headerFilterFunc:"starts"}
        : {title:TR("User name"), field:"user_name",
           headerFilter:userNameFilterEditor, headerFilterFunc:function(){},
           headerFilterLiveFilter:false};

    var columns = [
        userNameColumn,
        {title:TR("Plan"), field: "plan_name", headerFilter:"input", headerFilterFunc:"starts"},
        {title:TR("Seat"), field: "seat_name", headerFilter:"input", headerFilterFunc:"starts"}
    ];

    var initialSort = [];
    var initialHeaderFilter = [];

    if (report) {

        columns.splice(1,0,
            {title:TR("Login"), field: "login", headerFilter:"input", headerFilterFunc:"starts"}
        );

        columns.push(
            {title:TR("From"), field: "fromTS", width: 150, formatter:tsFormatter, headerFilter:dateFilterEditor, headerFilterFunc:">="},
            {title:TR("To"), field: "toTS", width: 150, formatter:tsFormatter, headerFilter:dateFilterEditor, headerFilterParams: { offset: 24*3600-1 }, headerFilterFunc:"<="},
            {title:TR("Timezone"), field: "plan_timezone", headerFilter:"input", headerFilterFunc:"starts"},
        );

        initialSort.push(
            {column:"from_utc", dir:"desc"},
            {column:"login", dir:"asc"}
        );

        // Backend-sourced today in a fixed reference (UTC) (PLAN
        // per_plan_timezone §7) — not browser-local, so the default window
        // doesn't shift with the admin's timezone. Fetched fresh on every
        // report mount (a long-lived SPA session can cross midnight).
        let ctxData = await Utils.xhr.get(window.warpGlobals.URLs['bookingsContext'], {toastOnSuccess: false});
        let todayTS = ctxData.response.today;
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

    var table = createTable(root.querySelector('#reportTable'), {
        ajaxURL: report ? window.warpGlobals.URLs['bookingsReport'] : window.warpGlobals.URLs['bookingsList'],
        index:"id",
        columns: columns,
        initialSort: initialSort,
        initialHeaderFilter: initialHeaderFilter
    });

    if (report) {

        root.querySelector('#export_btn_container').style.display = "";
        root.querySelector('#export_btn_icon').src = window.warpGlobals.URLs['excelIcon'];

        root.querySelector('#export_btn').addEventListener('click', function(e) {

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

            let noOfRows = table.getPageSize()*table.getPageMax();
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

        }, {signal: ctx.signal});
    }

    return function unmount() {
        table.destroy();
    };
}

export default { html, mount };
