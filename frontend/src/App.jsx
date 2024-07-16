import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";

// Pages & components
import Dashboard from "./pages/Dashboard";
import Connect from "./pages/Connect";
import Navbar from "./components/Navbar";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import PrivateRoute from "./components/PrivateRoute";
import { MetadataContextProvider } from "./context/MetadataContext";
import setAuthToken from "./utils/setAuthToken";

if (localStorage.token) {
  setAuthToken(localStorage.token);
}

function App() {
  useEffect(() => {
    if (localStorage.token) {
      setAuthToken(localStorage.token);
    }
  }, []);

  return (
    <div className="App">
      <MetadataContextProvider>
        <BrowserRouter>
          <Navbar />
          <div className="pages">
            <Routes>
              <Route path="/" element={<Login />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route
                path="/dashboard"
                element={
                  <PrivateRoute>
                    <Dashboard />
                  </PrivateRoute>
                }
              />
              <Route
                path="/connect"
                element={
                  <PrivateRoute>
                    <Connect />
                  </PrivateRoute>
                }
              />
            </Routes>
          </div>
        </BrowserRouter>
      </MetadataContextProvider>
    </div>
  );
}

export default App;
