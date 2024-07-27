import React, { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      // This commented out section is what initially worked to log in (but won't leave a cookie).
      // To properly test the new section, try to login in incognito; it won't work right now.
      // const response = await axios.post("http://localhost:4000/auth/login", { email, password });
      // localStorage.setItem("token", response.data.token);
      // navigate("/dashboard");
      const response = await axios.post(
        "http://localhost:4000/auth/login",
        { email, password },
        {
          withCredentials: true,
        }
      );

      // Navigate to dashboard if login successful (server sets cookies)
      if (response.status === 200) {
        navigate("/dashboard");
      } else {
        console.error("Login failed with status:", response.status);
      }
    } catch (err) {
      console.error("Error logging in", err);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>Login</h2>
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <button type="submit">Login</button>
      <p>
        Don't have an account? <a href="/signup">Sign up</a>
      </p>
    </form>
  );
};

export default Login;
