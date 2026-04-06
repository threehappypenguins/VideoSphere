import type { Step } from 'react-joyride';

export const onboardingSteps: Step[] = [
  {
    id: 'dashboard-overview',
    target: '[data-tour="dashboard-overview"]',
    skipBeacon: true,
    placement: 'auto',
    title: 'Welcome to VideoSphere',
    content:
      "VideoSphere helps you create drafts and distribute videos to multiple platforms at once. Let's walk through the main flow.",
  },
  {
    id: 'connected-accounts-link',
    target: '[data-tour="connected-accounts-link"]',
    skipBeacon: true,
    placement: 'auto',
    scrollOffset: 80,
    title: 'Connect Your Accounts',
    content:
      "Before uploading, you'll need to connect your YouTube, Vimeo, and other accounts. Let's visit that page now.",
  },
  {
    id: 'first-connect-button',
    target: '[data-tour="first-connect-button"]',
    skipBeacon: true,
    placement: 'bottom',
    scrollOffset: 80,
    title: 'Connect a Platform',
    content:
      'Click Connect to authorise VideoSphere to publish on your behalf. You can always add more platforms later from your profile.',
  },
  {
    id: 'drafts-nav-link',
    // NOTE: The actual target is overridden in OnboardingTour.tsx with a
    // visibility-checking function so the correct element is picked on both
    // desktop (sidebar) and mobile (tab bar). The string here is a fallback.
    target: '[data-tour="drafts-nav-link-desktop"], [data-tour="drafts-nav-link-mobile"]',
    skipBeacon: true,
    placement: 'auto',
    scrollOffset: 80,
    title: 'Go to Drafts',
    content:
      "Now let's head to the Drafts section where you create and manage your video projects.",
  },
  {
    id: 'create-draft-button',
    target: '[data-tour="drafts-create-draft-button"]',
    skipBeacon: true,
    placement: 'bottom',
    scrollOffset: 80,
    title: 'Create a New Draft',
    content:
      'Click "Create draft" to start a new project. This opens a form where you add your video details.',
  },
  {
    id: 'draft-platforms',
    target: '[data-tour="draft-platforms"]',
    skipBeacon: true,
    placement: 'auto',
    title: 'Choose Target Platforms',
    content:
      'Select which platforms you want to distribute to (e.g. YouTube, Vimeo). You can customise settings per platform later.',
  },
  {
    id: 'draft-title-input',
    target: '[data-tour="draft-title-input"]',
    skipBeacon: true,
    placement: 'auto',
    title: 'Add Your Video Title',
    content:
      'Give your video a title. This will be used for all platforms unless you customise it per platform.',
  },
  {
    id: 'draft-upload-section',
    target: '[data-tour="draft-upload-section"]',
    skipBeacon: true,
    placement: 'auto',
    title: 'Upload Your Video',
    content:
      'You can upload a video file here. VideoSphere will prepare it for distribution across your selected platforms.',
  },
  {
    id: 'draft-save',
    target: '[data-tour="draft-save-button"]',
    skipBeacon: true,
    placement: 'auto',
    title: "You're All Set!",
    content:
      "When you're ready to publish, this button uploads and distributes your video. Click Finish to complete this tour — we'll close this draft for now.",
  },
];
