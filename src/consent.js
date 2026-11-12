// Plain-language information sheet and consent items, shown to every
// participant before the camera is ever switched on.

export const CONSENT_VERSION = 1;

export const INFO = [
  'This is a classroom science activity, not a medical test. Nothing here can tell you whether you are healthy or ill, and no result should be used to make a health decision.',
  'The laptop camera measures your breathing and pulse from small changes in your face and chest, using the Presage SmartSpectra SDK. The camera is on only while an experiment is running, and a red "Camera on" label shows when it is.',
  'No video or photo is saved. The app keeps only numbers (for example "pulse 74 at second 31") on this laptop, under a code like P03 instead of your name.',
  'The measuring software contacts Presage over the internet only to check the licence key. The app turns Presage’s optional usage reports off. Your measurements are not sent anywhere.',
  'You can stop any experiment at any moment, skip any experiment, and withdraw later. Withdrawing deletes everything stored under your code, straight away.',
  'If results are shared (for example in a class report), they are shared only under your code, never with your name.',
];

export const ITEMS = [
  { id: 'age', text: 'I am 18 or older.' },
  { id: 'understand', text: 'I have read the information above and understand this is a science activity, not a health check.' },
  { id: 'camera', text: 'I agree to the camera measuring my breathing and pulse while an experiment I choose is running.' },
  { id: 'store', text: 'I agree that the numbers (not video) are stored on this laptop under my code.' },
  { id: 'withdraw', text: 'I know I can stop at any time and ask for my data to be deleted.' },
];
