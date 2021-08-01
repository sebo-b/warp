

function initBooking() {

    var rows = document.getElementsByClassName("book_row");

    for (var row of rows) {

        var data = {
            id: parseInt(row.dataset.id),
            seat_name: row.getElementsByClassName("book_seat")[0].innerText,
            zone_name: row.getElementsByClassName("book_zone")[0].innerText,
            fromTS: row.getElementsByClassName("book_from")[0].innerText,
            toTS: row.getElementsByClassName("book_to")[0].innerText,
            tableRow: row
        };

        var login = row.getElementsByClassName("book_login")
        if (login.length) {
            data['login'] = login[0].innerText;
        }

        remove = row.getElementsByClassName("book_remove")[0];
        remove.addEventListener('click',removeBooking.bind(null,data))
    }
}

function removeBooking(data) {

    let btnClicked = function(buttonId) {

        if (buttonId != 1)
            return;

        var action_data = { remove: [ data['id'] ]};
        
        var xhr = new XMLHttpRequest();
        xhr.open("POST", zoneApplyURL,true);
        xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
        xhr.addEventListener("load", function() {
            if (this.status == 200) {
                data['tableRow'].remove();
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
        onButtonHook: btnClicked
    }

    var msg = "";
    if (data['login']) {
        msg = "User: "+data['login']+"<br>";
    }

    msg +="Zone: "+data['zone_name']+"<br>"+
          "Seat: "+data['seat_name']+"<br>"+
          "From: "+data['fromTS']+"<br>"+
          "To: "+data['toTS'];

    WarpModal.getInstance().open("Are you sure to delete this booking?",msg,modalOptions);
}

window.addEventListener("load",initBooking)