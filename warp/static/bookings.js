

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

    var modalEl = document.getElementById('delete_confirmation');
    var modalElMsg = document.getElementById('delete_confirmation_msg');
    var modalElYes = document.getElementById('delete_confirmation_yes');

    let yesClicked = function() {

        var action_data = { bid: data['id']};
        
        var xhr = new XMLHttpRequest();
        xhr.open("POST", removeURL,true);
        xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
        xhr.addEventListener("load", function() {
            if (this.status == 200)
                data['tableRow'].remove();
            else
                alert("Error: "+this.status);
            });
    
        xhr.send( JSON.stringify( action_data));
    };

    let modal = M.Modal.getInstance(modalEl);
    if (!modal) {
        modal = M.Modal.init(modalEl,{ onCloseEnd: function() {
            modalElYes.removeEventListener('click', yesClicked);
            console.log("cleaning")
        }});
    }

    var msg = "";
    if (data['login']) {
        msg = "User: "+data['login']+"<br>";
    }

    msg +="Zone: "+data['zone_name']+"<br>"+
          "Seat: "+data['seat_name']+"<br>"+
          "From: "+data['fromTS']+"<br>"+
          "To: "+data['toTS'];

    modalElMsg.innerHTML = msg;
    modalElYes.addEventListener('click', yesClicked);
    modal.open();
}

window.addEventListener("load",initBooking)