import { Link } from "react-router-dom";

const Navbar = () => {
  return (
    <header>
      <div className="container">
        <Link to="/">
          <h1>VideoSphere</h1>
        </Link>
        <ul>
          <li><Link to="/">Home</Link></li>
          <li><Link to="/connect">Connect</Link></li>
        </ul>
      </div>
    </header>
  );
};

export default Navbar;
