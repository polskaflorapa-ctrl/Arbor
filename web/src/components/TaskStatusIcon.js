import AssignmentOutlined from '@mui/icons-material/AssignmentOutlined';
import BoltOutlined from '@mui/icons-material/BoltOutlined';
import CancelOutlined from '@mui/icons-material/CancelOutlined';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import EventOutlined from '@mui/icons-material/EventOutlined';
import PushPinOutlined from '@mui/icons-material/PushPinOutlined';
import RateReviewOutlined from '@mui/icons-material/RateReviewOutlined';
import VerifiedOutlined from '@mui/icons-material/VerifiedOutlined';

/**
 * Ikona statusu zlecenia (MUI), bez emoji.
 *
 * @param {object} props
 * @param {string} props.status — Nowe | Wycena_Terenowa | Do_Zatwierdzenia | Zaplanowane | W_Realizacji | Zakonczone | Anulowane
 * @param {number} [props.size]
 * @param {string} [props.color] — np. "#fff" w badge
 */
export default function TaskStatusIcon({ status, size = 16, color }) {
  const sx = { fontSize: size, ...(color ? { color } : {}) };
  switch (status) {
    case 'Zakonczone':
      return <CheckCircleOutline sx={sx} />;
    case 'W_Realizacji':
      return <BoltOutlined sx={sx} />;
    case 'Nowe':
      return <AssignmentOutlined sx={sx} />;
    case 'Wycena_Terenowa':
      return <RateReviewOutlined sx={sx} />;
    case 'Do_Zatwierdzenia':
      return <VerifiedOutlined sx={sx} />;
    case 'Zaplanowane':
      return <EventOutlined sx={sx} />;
    case 'Anulowane':
      return <CancelOutlined sx={sx} />;
    default:
      return <PushPinOutlined sx={sx} />;
  }
}
