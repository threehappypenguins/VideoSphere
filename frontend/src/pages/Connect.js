import React, { useEffect, useState } from 'react';

const Connect = () => {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const response = await fetch("http://localhost:4000/auth/google/status", {
          credentials: 'include',
        });
        const data = await response.json();
        setIsConnected(data.connected);
      } catch (error) {
        console.error('Error fetching status:', error);
      }
    };

    checkStatus();
  }, []);

  const handleConnectClick = () => {
    window.location.href = "http://localhost:4000/auth/google";
  };

  const handleDisconnectClick = async () => {
    try {
      const response = await fetch("http://localhost:4000/auth/google/logout", {
        method: 'GET',
        credentials: 'include',
      });
      const data = await response.text();
      console.log(data); // Optional: You can display a message to the user
      setIsConnected(false);
    } catch (error) {
      console.error('Error during logout:', error);
    }
  };

  return (
    <div>
      <h1>{isConnected ? "Connected to YouTube" : "Connect to YouTube"}</h1>
      <button onClick={isConnected ? handleDisconnectClick : handleConnectClick}>
        {isConnected ? "Disconnect YouTube" : "Connect to YouTube"}
      </button>
    </div>
  );
};

export default Connect;
