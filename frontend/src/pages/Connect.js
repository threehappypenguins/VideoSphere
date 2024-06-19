import React, { useEffect, useState } from 'react';

const Connect = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');

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

  // Function to handle storing tokens securely (using localStorage)
  const storeTokens = (accessToken, refreshToken) => {
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
  };

  // Function to handle connection click
  const handleConnectClick = () => {
    window.location.href = "http://localhost:4000/auth/google";
  };

  // Function to handle disconnection click
  const handleDisconnectClick = async () => {
    try {
      const response = await fetch("http://localhost:4000/auth/google/logout", {
        method: 'GET',
        credentials: 'include',
      });
      const data = await response.text();
      console.log(data); // Optional: You can display a message to the user
      setIsConnected(false);

      // Clear tokens from localStorage on disconnect
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    } catch (error) {
      console.error('Error during logout:', error);
    }
  };

  // On component mount, check for tokens in localStorage and set state accordingly
  useEffect(() => {
    const storedAccessToken = localStorage.getItem('accessToken');
    const storedRefreshToken = localStorage.getItem('refreshToken');

    if (storedAccessToken && storedRefreshToken) {
      setAccessToken(storedAccessToken);
      setRefreshToken(storedRefreshToken);
    }
  }, []);

  // When tokens are received from server (not shown in this snippet), invoke storeTokens
  // For example, after successful authentication callback
  useEffect(() => {
    if (accessToken && refreshToken) {
      storeTokens(accessToken, refreshToken); // Ensure storeTokens is called
    }
  }, [accessToken, refreshToken]);

  return (
    <div>
      <h1>{isConnected ? "Connected to YouTube" : "Connect to YouTube"}</h1>
      {isConnected ? (
        <button onClick={handleDisconnectClick}>Disconnect YouTube</button>
      ) : (
        <button onClick={handleConnectClick}>Connect to YouTube</button>
      )}
      {accessToken && refreshToken && (
        <div>
          <p>Access Token: {accessToken}</p>
          <p>Refresh Token: {refreshToken}</p>
        </div>
      )}
    </div>
  );
};

export default Connect;
