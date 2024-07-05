import React from "react";
import ReactDOM from "react-dom";

const Modal = ({ onClose, children }) => {
  return ReactDOM.createPortal(
    <div className="modal">
      <div className="modal-content">
        <span className="close" onClick={onClose}>
          &times;
        </span>
        {children}
      </div>
    </div>,
    document.getElementById("modal-root")
  );
};

export default Modal;
