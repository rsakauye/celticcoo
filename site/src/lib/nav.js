// Main header groups. Home is the logo. About is a plain link.
// The only filled control is Add yours. Play lists live tools only.
import bookingConfig from '../../../data/booking.json' with { type: 'json' };

export const PLAY_BLURB = 'Tune your drones on your phone';

export const NAV_GROUPS = [
  {
    id: 'events',
    label: 'Events',
    items: [
      { href: 'events/', label: 'Upcoming events' },
      { href: 'results/', label: 'Results' },
      { href: 'burns-night/', label: 'Burns Night' },
    ],
  },
  {
    id: 'community',
    label: 'Community',
    items: [
      { href: 'groups/', label: 'Clubs & lessons' },
      { href: 'book/', label: bookingConfig.navLabel },
      { href: 'shops/', label: 'Shops' },
      { href: 'fundraising/', label: 'Fundraising' },
    ],
  },
  {
    id: 'heritage',
    label: 'Heritage',
    items: [
      { href: 'tartans/', label: 'Find your tartan' },
      { href: 'roots/', label: 'Trace your roots' },
      { href: 'what-to-wear/', label: 'What to wear' },
    ],
  },
  {
    id: 'play',
    label: 'Play',
    items: [
      { href: 'tune/', label: 'Drone tuner', blurb: PLAY_BLURB },
    ],
  },
];

export const NAV_ABOUT = { href: 'about/', label: 'About' };
export const NAV_CTA = { href: 'submit/', label: 'Add yours' };
