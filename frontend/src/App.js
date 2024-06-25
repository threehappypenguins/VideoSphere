import { BrowserRouter, Routes, Route } from "react-router-dom";

// Pages & components
import Dashboard from "./pages/Dashboard";
import Connect from "./pages/Connect";
import Navbar from "./components/Navbar";

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Navbar />
        <div className="pages">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/connect" element={<Connect />} />
          </Routes>
        </div>
      </BrowserRouter>
    </div>
  );
}

export default App;
