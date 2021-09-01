"use strict";

if (typeof(UserData) === 'undefined')
    throw Error('users.js requires userdata module');

function initUsers(userData) {

    var roleSelectEl = document.getElementById('role_select');

    var editModalEl = document.getElementById('edit_modal');
    var editModal = M.Modal.init(editModalEl, { 
        onCloseEnd: function() {
            // we need to tear down materialize select and recreate it
            // as there is no (exposed) API to select option
            let roleSelect = M.FormSelect.getInstance(roleSelectEl);
            if (roleSelect) {
                roleSelect.destroy();
                roleSelectEl.innerHTML = "";
            }
        }
    });

    var loginEl = document.getElementById("login");
    var nameEl = document.getElementById("name");
    var errorDiv = document.getElementById("error_div");
    var errorMsg = document.getElementById("error_message");

    var deleteBtn = document.getElementById('edit_modal_delete_btn');

    var myRole = userData.getRole();

    var roles = Object.keys(UserData.Roles).sort((a,b) => parseInt(a) - parseInt(b));

    var showEditModal = function(login,role,name) {

        login = login || "";
        role = typeof(role) === 'undefined'? 2: role;   // default User
        name = name || "";

        loginEl.value = login;
        loginEl.disabled = login !== "";

        deleteBtn.style.display = 
            login !== ""? "inline-block": "none";

        // it is not a good idea to delete itself
        if (userData.getRealLogin() == login)
            deleteBtn.style.display = "none";

        nameEl.value = name;

        for (let r of roles) {

            if (r < myRole)
                continue;

            let optEl = document.createElement('option');
            optEl.value = r;
            optEl.appendChild( document.createTextNode(UserData.Roles[r]));
            if (r == role)
                optEl.selected = "true";
            roleSelectEl.appendChild(optEl);
        }

        M.FormSelect.init(roleSelectEl);

        p1.value = "";
        p1.type = "password";
        p2.value = "";
        p2.type = "password";

        errorDiv.style.display = "none";
        errorMsg.innerText = "";

        M.updateTextFields();
        editModal.open();
    }

    var addUserBtn = document.getElementById('add_user_btn');
    addUserBtn.addEventListener('click', function(e) {
        //var ed = document.querySelector("");
        showEditModal();
    });

    var showPassBtns = document.getElementsByClassName('show_password_btn');
    for (let b of showPassBtns) {
        let input = b.parentNode.getElementsByTagName('INPUT')[0];
        b.addEventListener('click', function(e){
            input.type = input.type == "text"? "password": "text";
        })
    }

    var p1 = document.getElementById('password');
    var p2 = document.getElementById('password2');
    document.getElementById('generate_password_btn').addEventListener('click', function(e) {
        let array = new Uint8Array(10);
        window.crypto.getRandomValues(array);

        let res = new String();
        let validChars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&*+-:;<=>?@^|";
        for (let i of array) {
            res = res + validChars[ i % validChars.length ];
        }

        p1.value = res;
        p1.type = "text";

        p2.value = res;
        p2.type = "text";

        M.updateTextFields();
    });

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
        
        let data = cell.getRow().getData();

        if (data.role < myRole)
            return;

        showEditModal(data.login, data.role, data.name);
    }

    var data = userData.getData();
    var tableData = [];
    for (let i in data)
        tableData.push(  Object.assign({login: i},data[i]));

    var rolesFilter = [ { label: "---"} ];
    for (let i of roles) {
        rolesFilter.push({
            label: UserData.Roles[i],
            value: i
        });
    }

    var table = new Tabulator("#usersTable", {
        height:"100%",
        data:tableData,
        index:"login",
        layout:"fitColumns",
        resizableColumns:true,
        columns:[
            {formatter:editFormatter, width:40, hozAlign:"center", cellClick:editClicked, headerSort:false},
            {title:"Login", field: "login", headerFilter:"input"},
            {title:"Name", field: "name", headerFilter:"input"},
            {title:"Role", field: "role", headerFilter:"input", formatter:roleFormatter, 
                headerFilter:"select", headerFilterParams:{ values: rolesFilter } },
        ],
        initialSort:[
            {column:"Name", dir:"asc"}
        ]
    });

    document.getElementById('edit_modal_save_btn').addEventListener('click', function(e){

        let err = "";
        if (p1.value !== p2.value) {
            err = "Passwords doesn't match";
        }

        if (loginEl.disabled) {
            if (nameEl.value === "")
                err = "Name cannot be empty.";
        }
        else if (loginEl.value === "" || nameEl.value === "" || p1.value === "") {
            err = "All fields are mandatory";
        }

        if (err) {
            errorMsg.innerText = err;
            errorDiv.style.display = "block";
            return;
        }

        errorDiv.style.display = "none";

        let roleSelect = M.FormSelect.getInstance(roleSelectEl);
        let action = loginEl.disabled? "update": "add";

        let actionData = {
            login: loginEl.value,
            name: nameEl.value,
            role: parseInt(roleSelect.getSelectedValues()[0]),
            action: action
        };

        if (p1.value !== "")
            actionData['password'] = p1.value;

        var xhr = new XMLHttpRequest();    
        xhr.open("POST", window.warpGlobals.URLs['editUser']);
        xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
        xhr.addEventListener("load", function(e) {
            var resp = JSON.parse(this.responseText);
            if (this.status == 200) {
                // let's update table
                table.updateOrAddData(resp);

                // and userData, but for that we need to transform the data
                userData.updateOrAddData( 
                    Object.fromEntries( 
                        resp.map((e) => [ e.login, {name: e.name, role: e.role} ]
                    )));

                // as the last step we reinitialize actAs field
                initActAs(userData);

                M.toast({html: 'Action successfull.'});
                editModal.close();    
            }
            else {
                errorMsg.innerText = resp.msg;
                errorDiv.style.display = "block";    
            }
        });
        xhr.send( JSON.stringify(actionData));

    });

    deleteBtn.addEventListener('click', function(e) {

        let modalBtnClicked = function(buttonId) {

            if (buttonId != 1)
                return;

            let actionData = {
                login: loginEl.value,
                action: "delete"
            };

            var xhr = new XMLHttpRequest();    
            xhr.open("POST", window.warpGlobals.URLs['editUser']);
            xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
            xhr.addEventListener("load", function(e) {
                var resp = JSON.parse(this.responseText);
                if (this.status == 200) {

                    var logins = Object.values(resp).map((e) => e.login);

                    // let's update table and userdata
                    table.deleteRow(logins);
                    userData.delete(logins);

                    // as the last step we reinitialize actAs field
                    initActAs(userData);
    
                    M.toast({html: 'Action successfull.'});
                    editModal.close();    
                }
                else {
                    WarpModal.getInstance().open("Error",resp.msg);
                }
            });
            xhr.send( JSON.stringify(actionData));

        }

        var modalOptions = {
            buttons: [
                {id: 1, text: "YES"},
                {id: 0, text: "NO"}
            ],
            onButtonHook: modalBtnClicked
        }
    
        var msg = "This will fail if user had any bookings in the past, so it is usually a better idea to BLOCK user.";
    

        WarpModal.getInstance().open("Are you sure to delete user: "+loginEl.value,msg,modalOptions);

    });
}

UserData.getInstance().on('load',initUsers);
