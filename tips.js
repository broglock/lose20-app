/* Maya's lines and food content. Time-of-day ideas (JITAI-style), traffic-light reactions,
   comeback lines for slips, and if-then plans keyed to the problems coach.js detects. */
(function (root) {
  'use strict';

  // Meal ideas with rough numbers, by time of day.
  const IDEAS = {
    breakfast: [
      ['3-egg veggie omelette + 1 toast', 380, 26], ['Greek yogurt, berries, 2 tbsp granola', 320, 25],
      ['Protein oats: oats, whey, banana', 420, 35], ['Cottage cheese + pineapple + walnuts', 300, 26],
      ['2 eggs, turkey bacon, tomato, rye toast', 400, 30], ['Protein smoothie: whey, spinach, berries, milk', 330, 32]
    ],
    lunch: [
      ['Chicken burrito bowl, no cheese, extra salsa', 520, 42], ['Tuna salad wrap with greens', 430, 35],
      ['Lentil soup + side salad', 420, 24], ['Turkey and avocado on rye + apple', 480, 32],
      ['Leftover salmon over greens and quinoa', 520, 38], ['Big Greek salad with grilled chicken', 470, 40]
    ],
    snack: [
      ['Apple + string cheese', 170, 7], ['Beef jerky + carrots', 150, 15], ['Greek yogurt cup', 120, 15],
      ['Hard-boiled eggs x2', 140, 12], ['Edamame, 1 cup', 190, 17], ['Protein shake with water', 130, 25]
    ],
    dinner: [
      ['Grilled chicken, roasted veg, 1/2 cup rice', 550, 45], ['Salmon, asparagus, small potato', 560, 40],
      ['Lean beef stir-fry with lots of veg', 520, 40], ['Turkey chili with beans', 480, 38],
      ['Shrimp tacos on corn tortillas + slaw', 500, 35], ['Pork tenderloin, green beans, sweet potato', 520, 42]
    ]
  };

  // Spoken reactions to a meal by traffic light. {kcal} {left} filled in by the app.
  const REACT = {
    green: [
      'Now that is a plate. Great pick, keep them coming.', 'Green light! That is exactly how 20 pounds come off.',
      'Look at you. Lean, filling, and it leaves room for dinner.', 'Love it. Your future self says thanks.'
    ],
    yellow: [
      'Not bad. Next time, more veggies and a bit less of the heavy stuff.', 'Middle of the road. A small swap would make it a green.',
      'Okay, that works if dinner is lean. Deal?', 'Decent. Watch the sauces and you are golden.'
    ],
    red: [
      'Whoa, hold up. That one is heavy. Let us make the rest of today really clean.', 'Red light on that one. It eats a big chunk of your day.',
      'Hmm, that is a lot of calories for not much protein. Smaller portion next time?', 'That one hurts the plan. Not the end of the world, but dinner has to be light.'
    ]
  };

  const WEIGH_REACT = {
    down: ['Trend is heading down. That is the line that matters.', 'Down again. The work is showing.', 'Nice. Slow and steady is how it sticks.'],
    flat: ['Flat today. Water and salt move the scale, the trend tells the truth.', 'Holding steady. Keep logging and it will move.'],
    up: ['Up a bit. Do not panic, it is probably water. Clean day today.', 'Little bump. One great day erases that, let us have it.']
  };

  // Comeback mode: warm, one easy action, no guilt (research: scolding backfires).
  const COMEBACK = [
    'Hey, I missed you. No lecture. Just log your next meal and we are back on track.',
    'Fresh start right now. One photo of your next meal, that is all I am asking.',
    'Gaps happen to everyone who succeeds. What matters is today. Step on the scale and let us go.',
    'You did not fall off, you paused. Log one thing today and the streak shield has your back.'
  ];
  const MONDAY = ['New week, full points bank. Let us protect all 200.', 'Monday reset. Weigh in, big protein breakfast, and we are rolling.'];

  // Motivation lines (original), shown on the Today screen and in check-ins.
  const MOTIVATE = [
    'You do not need perfect days. You need logged days.', 'Every meal you log is a vote for the guy who is 20 pounds lighter.',
    'Lifting keeps the weight you lose from being muscle. Show up.', 'The scale lags. Your habits lead. Trust the habits.',
    'One clean meal at a time. That is the whole secret.', 'Protein first, vegetables second, everything else third.',
    'Hungry at night is a habit, not an emergency. Tea, then bed.', 'Weekends count. Same rules, same results.',
    'At 60, strong beats skinny. We are building strong and lean.', 'Small plate, slow fork, big glass of water.'
  ];

  // If-then plans, keyed to coach.js problem keys (implementation intentions).
  const PLANS = {
    late: ['If I want a snack after 8 pm, then I have herbal tea and wait 15 minutes.', 'If dinner is done, then I brush my teeth right away.'],
    weekend: ['If it is Friday, then I plan Saturday and Sunday meals before bed.', 'If I eat out on the weekend, then I order protein and vegetables first and skip the bread basket.'],
    protein: ['If I make breakfast, then it starts with eggs, Greek yogurt or a shake.', 'If I finish a workout, then I have 30 g of protein within 2 hours.'],
    calories: ['If I serve dinner, then half the plate is vegetables before anything else goes on it.', 'If I want seconds, then I wait 20 minutes and drink a glass of water first.'],
    logging: ['If food is in front of me, then I take the photo before the first bite.', 'If I sit down for lunch, then I log breakfast and lunch right then.'],
    weighin: ['If I wake up and use the bathroom, then I step on the scale before coffee.'],
    breakfast: ['If it is a workday morning, then I eat breakfast before I open email.'],
    fiber: ['If I make lunch, then I add a cup of beans, lentils or veg to it.'],
    quality: ['If I want chips, then I have air-popped popcorn or veggies and hummus instead.'],
    gym: ['If it is a gym day and I do not feel like it, then I go for just 10 minutes.', 'If I miss a gym day, then I take a 30-minute brisk walk that evening.'],
    undereating: ['If I am more than 500 under by 7 pm, then I have a protein snack.'],
    rate: ['If the trend has not moved for 2 weeks, then I measure oil and sauces for 7 days.'],
    general: ['If I pass the kitchen without being hungry, then I keep walking.', 'If I am stressed, then I take a 10-minute walk before I eat anything.']
  };

  function slotOf(hour) { return hour < 10.5 ? 'breakfast' : hour < 14 ? 'lunch' : hour < 16.5 ? 'snack' : hour < 20 ? 'dinner' : 'snack'; }
  function pick(list, seed) { let h = 0; const s = String(seed); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return list[Math.abs(h) % list.length]; }

  // One time-appropriate idea that fits what's left today.
  function ideaFor(hour, kcalLeft, proteinLeft, seed) {
    const slot = slotOf(hour);
    const fits = IDEAS[slot].filter(i => i[1] <= Math.max(150, kcalLeft));
    const list = (fits.length ? fits : IDEAS.snack).slice().sort((a, b) => (b[2] / b[1]) - (a[2] / a[1]));
    const top = proteinLeft > 40 ? list.slice(0, 3) : list;
    const i = pick(top, seed);
    return { slot, name: i[0], kcal: i[1], protein: i[2] };
  }

  const api = { IDEAS, REACT, WEIGH_REACT, COMEBACK, MONDAY, MOTIVATE, PLANS, ideaFor, pick, slotOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Tips = api;
})(typeof self !== 'undefined' ? self : this);
