"strict on";

function WarpModal() {

    var modalElement =  document.createElement("div");
    modalElement.className = "modal";

    var rootContent = modalElement.appendChild( document.createElement("div") );
    rootContent.className = "modal-content";

    this.headerElement = rootContent.appendChild( document.createElement("h4") );
    this.messageElement = rootContent.appendChild( document.createElement("p") );

    var footerElement = modalElement.appendChild( document.createElement("div") );
    footerElement.className = "modal-footer";

    var buttonElement = footerElement.appendChild( document.createElement("a") );
    buttonElement.className = "modal-close waves-effect btn";
    buttonElement.href = "#!";
    buttonElement.innerText = "Ok";

    document.body.appendChild(modalElement);

    this.onCloseHook = null;
    this.modal = M.Modal.init(modalElement, 
        { onCloseEnd: function() {
                if (typeof(this.onCloseHook) === 'function') {
                    this.onCloseHook();
                    this.onCloseHook = null;
                }
            }.bind(this)
        });
    
    this.open = function(header,content,onCloseHook) {
        this.headerElement.innerText = header;
        this.messageElement.innerText = content;
        this.onCloseHook = onCloseHook;
        
        this.modal.open();
    }
};

WarpModal.Instance = null;
WarpModal.getInstance = function() { 
    if (!WarpModal.Instance)
        WarpModal.Instance = new WarpModal();
    
    return WarpModal.Instance;
};
