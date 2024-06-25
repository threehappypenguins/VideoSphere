import { useEffect, useState } from "react";
import { useMetadataContext } from "../hooks/useMetadataContext";

// Components
import MetadataDetails from "../components/MetadataDetails";
import MetadataForm from "../components/MetadataForm";
import Modal from "../components/Modal";

const Dashboard = () => {
  const { metadata, dispatch } = useMetadataContext();
  const [metadataFormVisible, setmetadataFormVisible] = useState(false);

  useEffect(() => {
    const fetchMetadata = async () => {
      const response = await fetch("/api/metadata");
      const json = await response.json();

      if (response.ok) {
        dispatch({ type: "SET_METADATA", payload: json });
      }
    };

    fetchMetadata();
  }, [dispatch]);

  const toggleFormVisibility = () => {
    setmetadataFormVisible(!metadataFormVisible);
  };

  const handleFormSubmit = async (metadatasubm) => {
    const response = await fetch("/api/metadata", {
      method: "POST",
      body: JSON.stringify(metadatasubm),
      headers: {
        "Content-Type": "application/json",
      },
    });
    const json = await response.json();

    if (response.ok) {
      dispatch({ type: "CREATE_METADATA", payload: json });
      setmetadataFormVisible(false); // Close the modal after successful form submission
    } else {
      // Handle error if needed
      console.error(json.error);
    }
  };

  return (
    <div className="dashboard">
      <div className="button-container">
        <button onClick={toggleFormVisibility} className="modal-button">
          Create New Livestream
        </button>
      </div>
      {metadataFormVisible && (
        <Modal onClose={toggleFormVisibility}>
          <MetadataForm onSubmit={handleFormSubmit} />
        </Modal>
      )}
      <div className="metadata">
        {metadata &&
          metadata.map((metadatasubm) => (
            <MetadataDetails
              key={metadatasubm._id}
              metadatasubm={metadatasubm}
            />
          ))}
      </div>
    </div>
  );
};

export default Dashboard;
