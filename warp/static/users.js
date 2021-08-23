"use strict";

if (typeof(UserData) === 'undefined')
    throw Error('users.js requires userdata module');

function initUsers(userData) {

    var userData = UserData.getInstance();
    var myRole = userData.getRole();

    var editFormatter = function(cell, formatterParams) {
        if (cell.getRow().getData().role >= myRole)
            return '<i class="material-icons-outlined">edit</i>';
        else
            return "";
    }

    var roleFormatter = function(cell, formatterParams) {
        return UserData.formatRole(cell.getValue());
    }

    var editClicked = function(e,cell) {
    }

    var rolesFilterEmptyCheck = function(v) {
        return v < 0;
    };

    var data = userData.getData();
    var tableData = [];
    for (let i in data)
        tableData.push(  Object.assign({login: i},data[i]));

    var rolesFilter = [ { label: "---"} ];
    for (let i of Object.keys(UserData.Roles).sort((a,b) => parseInt(a) - parseInt(b) )) {
        rolesFilter.push({
            label: UserData.Roles[i],
            value: i
        });
    }

    var table = new Tabulator("#usersTable", {
        maxHeight:"95%",
        data:tableData,
        index:"login",
        layout:"fitColumns",
        resizableColumns:true,
        columns:[
            {title:"Login", field: "login", headerFilter:"input"},
            {title:"Name", field: "name", headerFilter:"input"},
            {title:"Role", field: "role", headerFilter:"input", formatter:roleFormatter, 
                headerFilter:"select", headerFilterParams:{ values: rolesFilter } },
            {formatter:editFormatter, width:40, hozAlign:"center", cellClick:editClicked, headerSort:false},
        ],
        initialSort:[
            {column:"Name", dir:"asc"}
        ]
    });
}

UserData.getInstance().on('load',initUsers);
