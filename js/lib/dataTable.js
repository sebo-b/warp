'use strict';

// Builds a compact <table class="warp-data-table"> for showing structured
// data inside a WarpModal message — either label/value pairs (release-booking
// confirmation, conflict warnings) or repeating multi-column rows (auto-book
// results). Cells are set via innerText/appendChild (never innerHTML), so
// callers don't need to hand-escape values themselves.
//
// rows: array of arrays; each inner array is one row's cells. A cell is
// either a string (rendered as text) or a Node (appended as-is, e.g. a
// fragment with embedded <br>s).
export function buildDataTable(rows) {
    var table = document.createElement('table');
    table.className = 'warp-data-table';

    for (let row of rows) {
        let tr = table.appendChild(document.createElement('tr'));
        for (let cell of row) {
            let td = tr.appendChild(document.createElement('td'));
            if (cell instanceof Node)
                td.appendChild(cell);
            else
                td.innerText = cell;
        }
    }

    return table;
}

export default buildDataTable;
