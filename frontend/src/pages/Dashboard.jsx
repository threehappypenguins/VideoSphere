import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { useMetadataContext } from "../hooks/useMetadataContext";

// Components
import MetadataDetails from "../components/MetadataDetails";
import MetadataForm from "../components/MetadataForm";
import Modal from "../components/Modal";

const Dashboard = () => {
  const { metadata, dispatch } = useMetadataContext();
  const [metadataFormVisible, setmetadataFormVisible] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchMetadata = async () => {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/metadata', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.status === 200) {
        dispatch({ type: 'SET_METADATA', payload: response.data });
      }
    };

    fetchMetadata();
  }, [dispatch]);

  const toggleFormVisibility = () => {
    setmetadataFormVisible(!metadataFormVisible);
  };

  const handleFormSubmit = async (metadatasubm) => {
    const token = localStorage.getItem('token');
    const response = await axios.post('/api/metadata', metadatasubm, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 200) {
      dispatch({ type: 'CREATE_METADATA', payload: response.data });
      setmetadataFormVisible(false);
    } else {
      console.error(response.data.error);
    }
  };

  const handleLogout = async () => {
    try {
      const response = await fetch('http://localhost:4000/auth/logout', {
        method: 'POST',
        credentials: 'include', // Ensure cookies are included
      });

      if (response.ok) {
        navigate('/login');
      } else {
        console.error('Logout failed');
      }
    } catch (error) {
      console.error('Error during logout:', error);
    }
  };

  return (
    <div className="dashboard">
      <button onClick={handleLogout}>Logout</button>
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