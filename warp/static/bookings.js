


function removeBooking(bookId,tableRow,val) {

    var modalEl = document.getElementById('delete_confirmation');
    var modalElMsg = document.getElementById('delete_confirmation_msg');
    var modalElYes = document.getElementById('delete_confirmation_yes');

    let yesClicked = function() {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", removeBookingsURL,true);
        xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
        xhr.addEventListener("load", function() {
    
            if (this.status == 200)
                tableRow.parentNode.removeChild(tableRow)
            else if (this.status == 403)
                alert("You are not allowed to remove this entry");
            else if (this.status == 404)
                alert("Invalid entry");
            else
                alert("Error: "+this.status);
        });
        xhr.send("bid="+bookId);
    };

    let modal = M.Modal.getInstance(modalEl);
    if (!modal) {
        modal = M.Modal.init(modalEl,{ onCloseEnd: function() {
            modalElYes.removeEventListener('click', yesClicked);
            console.log("cleaning")
        }});
    }

    modalElMsg.innerText = "Seat "+ val['seat_name'] + " at " + val['zone_name'] + " from " + val['fromTS'] + " to " + val['toTS'] +".";
    modalElYes.addEventListener('click', yesClicked);
    modal.open();
}

function fillBookings(dstId) {

    var xhr = new XMLHttpRequest();
    xhr.addEventListener("load", function() {

        resp = JSON.parse(this.responseText);

        target = document.getElementById(dstId);
        target.innerHTML = "";

        if (Object.values(resp).lenght == 0)
            return;
        
        showUsername = ("username" in Object.values(resp)[0])

        headerRow = target.appendChild( document.createElement("tr") );
        if (showUsername) {
            headerRow.appendChild( document.createElement("th") ).appendChild( document.createTextNode('User') );    
        }
        headerRow.appendChild( document.createElement("th") ).appendChild( document.createTextNode('Zone name') );
        headerRow.appendChild( document.createElement("th") ).appendChild( document.createTextNode('Seat name') );
        headerRow.appendChild( document.createElement("th") ).appendChild( document.createTextNode('From') );
        headerRow.appendChild( document.createElement("th") ).appendChild( document.createTextNode('To') );
        headerRow.appendChild( document.createElement("th") ).appendChild( document.createTextNode('Comment') );
        headerRow.appendChild( document.createElement("th") );
    
        for (p in resp) {

            val = resp[p];
            row = target.appendChild( document.createElement("tr") );

            if (showUsername) {
                row.appendChild( document.createElement("td") ).appendChild( document.createTextNode(val['username']) );
            }
                
            row.appendChild( document.createElement("td") ).appendChild( document.createTextNode(val['zone_name']) );
            row.appendChild( document.createElement("td") ).appendChild( document.createTextNode(val['seat_name']) );
            row.appendChild( document.createElement("td") ).appendChild( document.createTextNode(val['fromTS']) );
            row.appendChild( document.createElement("td") ).appendChild( document.createTextNode(val['toTS']) );
            row.appendChild( document.createElement("td") ).appendChild( document.createTextNode(val['comment']) );

            aLink = row.appendChild( document.createElement("td") ).appendChild( document.createElement("a") );
            aLink.appendChild( document.createTextNode('remove'));
            aLink.setAttribute("href","#")
            aLink.addEventListener("click", removeBooking.bind(null,p,row,val));
        }


    });

    xhr.open("GET", getBookingsURL);
    xhr.send();

}

window.addEventListener("load",fillBookings.bind(null,dstTagId))
