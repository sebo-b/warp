"use strict";

export default function WarpModal() {

    var modalElement =  document.createElement("dialog");
    modalElement.className = "modal warp-form-modal warp-fields warp-modal-sm";

    var rootContent = modalElement.appendChild( document.createElement("div") );
    rootContent.className = "modal-content";

    this.headerElement = rootContent.appendChild( document.createElement("h4") );
    this.messageElement = rootContent.appendChild( document.createElement("p") );

    this.footerElement = modalElement.appendChild( document.createElement("div") );
    this.footerElement.className = "modal-footer";

    document.body.appendChild(modalElement);

    this.clickedBtnId = null;

    this.modal = warpDialog(modalElement,
        { onCloseEnd: function() {

                //local copy
                var cancelHook = this.options.onCancelHook;
                var clickedBtnId = this.clickedBtnId;
                var btnHook = this.options.onButtonHook;

                //object clean up before calling hooks
                //as modal can be shown inside a hook
                delete this.options;
                this.clickedBtnId = null;
                this.footerElement.innerHTML = "";

                if (clickedBtnId !== null && typeof(btnHook) === 'function')
                    btnHook(clickedBtnId);
                else if (typeof(cancelHook) === 'function')
                    closeHook();

            }.bind(this)
        });

    /**
     * options = {
     *  buttons: [
     *    { id: btn_id1, text: "Button Text" },
     *    { id: btn_id2, text: "Button Text" },
     *  ],
     *  onButtonHook: function(button_id),
     *  onCancelHook:  function()
     * }
     **/
    this.open = function(header,content,options = null) {
        this.headerElement.innerText = header;
        this.messageElement.innerHTML = content;

        this.options = Object.assign({}, WarpModal.default_options, options)

        this.options.buttons.forEach(function(b, i) {
            var bElem = this.footerElement.appendChild( document.createElement("a") );
            // First button is the affirmative action (Yes/Ok/Confirm) -> primary
            // (filled, picks up the footer's indigo from style.css); rest flat.
            bElem.className = (i === 0)
                ? "modal-close waves-effect waves-light btn"
                : "modal-close waves-effect waves-light btn-flat";

            bElem.href = "#!";
            bElem.innerText = b.text;
            bElem.addEventListener('click', function() {
                this.clickedBtnId = b.id;
                }.bind(this));
            }.bind(this));

        this.modal.open();
    };
};

WarpModal.default_options = {
    buttons: [
        { id: true, text: TR("btn.Ok") }
    ]
};

WarpModal.Instance = null;
WarpModal.getInstance = function() {
    if (!WarpModal.Instance)
        WarpModal.Instance = new WarpModal();

    return WarpModal.Instance;
};
