// Copied from TaskMint packages/client/src/components/cloud/GoogleSignInButton.tsx @ 5b818b6.
/**
 * "Continue with Google" as Google's own sign-in button
 * (developers.google.com/identity/branding-guidelines): the colour G and
 * Google Sans Medium 14/20 on Google's light button, or its dark one in the
 * dark theme, 12px in from each end with 10px between the G and the text.
 * Google allows only its light, dark and neutral looks, so the button takes
 * none of the app's palette, only its focus ring and touch-target height.
 * The pill is the closer of Google's two shapes to the app's rounded
 * buttons.
 */

// Latin only: the text is English, and Google asks for Google Sans
import '@fontsource/google-sans/latin-500.css';
import { ButtonBase, useTheme } from '@mui/material';
import { focusColor } from '../../theme/components';
import { HOVER, TOUCH } from '../../theme/media';

/** Google's fill, edge and text, the tint its states lay over them, and their disabled forms. */
const LOOKS = {
  light: {
    fill: '#FFFFFF',
    edge: '#747775',
    text: '#1F1F1F',
    state: '#303030',
    disabledFill: 'rgba(255, 255, 255, 0.61)',
    disabledEdge: 'rgba(31, 31, 31, 0.12)',
  },
  dark: {
    fill: '#131314',
    edge: '#8E918F',
    text: '#E3E3E3',
    state: '#FFFFFF',
    disabledFill: 'rgba(19, 19, 20, 0.61)',
    disabledEdge: 'rgba(142, 145, 143, 0.12)',
  },
};

const HOVER_SHADOW = '0 1px 2px 0 rgba(60, 64, 67, 0.3), 0 1px 3px 1px rgba(60, 64, 67, 0.15)';

/** Google's standard colour G, which mustn't be recoloured. */
function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
      <path
        fill="#E94235"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC04"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export function GoogleSignInButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  const mode = useTheme().palette.mode;
  const look = LOOKS[mode];
  return (
    <ButtonBase
      disableRipple
      disabled={disabled}
      onClick={onClick}
      sx={{
        gap: '10px',
        height: '40px',
        maxWidth: '400px',
        padding: '0 12px',
        border: `1px solid ${look.edge}`,
        borderRadius: '9999px',
        backgroundColor: look.fill,
        color: look.text,
        fontFamily: '"Google Sans", Roboto, Arial, sans-serif',
        fontSize: '14px',
        fontWeight: 500,
        lineHeight: '20px',
        whiteSpace: 'nowrap',
        transition: 'background-color .218s, border-color .218s, box-shadow .218s',
        [TOUCH]: { height: '44px' },
        // The state tint, over the fill and under the G and text
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          backgroundColor: look.state,
          opacity: 0,
          transition: 'opacity .218s',
          pointerEvents: 'none',
        },
        [HOVER]: { '&:hover': { boxShadow: HOVER_SHADOW, '&::before': { opacity: 0.08 } } },
        '&:active::before, &:focus-visible::before': { opacity: 0.12 },
        '&:focus-visible': { outline: `2px solid ${focusColor(mode)}`, outlineOffset: '2px' },
        '&.Mui-disabled': {
          backgroundColor: look.disabledFill,
          borderColor: look.disabledEdge,
          '& > *': { opacity: 0.38 },
        },
      }}
    >
      <GoogleG />
      <span>Continue with Google</span>
    </ButtonBase>
  );
}
