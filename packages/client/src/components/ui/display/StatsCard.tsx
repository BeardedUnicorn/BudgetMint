// Copied from TaskMint packages/client/src/components/ui/display/StatsCard.tsx @ 1623bee: keep the two in step.
import { Card, CardContent, Typography, Box } from '@mui/material';
import { StatsCardProps } from '../../../types/ui';
import { PHONE } from '../../../theme/media';

/** A headline figure (already formatted) with its title, a note under it, and an icon. */
export function StatsCard({ title, value, subtitle, icon, color }: StatsCardProps) {
  const tint = `${color}.main`;
  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Two to a row on a phone: tighter, without the icon */}
      <CardContent sx={{ flex: 1, p: 3, [PHONE]: { p: 2, '&:last-child': { pb: 2 } } }}>
        <Box
          sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2, [PHONE]: { mb: 0 } }}
        >
          <Box sx={{ flex: 1 }}>
            <Typography
              variant="h4"
              component="div"
              sx={{
                color: tint,
                fontWeight: 700,
                mb: 0.5,
                fontFamily: '"Roboto Mono", monospace',
                [PHONE]: { fontSize: '1.25rem' },
              }}
            >
              {value}
            </Typography>
            <Typography variant="body1" color="text.primary" sx={{ fontWeight: 600 }}>
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {subtitle}
            </Typography>
          </Box>
          <Box sx={{ color: tint, opacity: 0.7, ml: 2, [PHONE]: { display: 'none' } }}>{icon}</Box>
        </Box>
      </CardContent>
    </Card>
  );
}
