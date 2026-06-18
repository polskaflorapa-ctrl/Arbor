import { Navigate } from 'react-router-dom';
import { getStoredToken } from '../utils/storedToken';

export default function LandingCommand() {
  if (getStoredToken()) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Navigate to="/login" replace />;
}
