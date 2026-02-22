const handleDreamSubmit = async () => {
  const val = dreamRef.current?.value || '';
  if (!val.trim()) return;

  setDreamText(val);
  setDreamSubmitted(true);
  await saveEntry({ dream: val });

  // Call Gemini via Cloud Function
  try {
    const response = await fetch(
      'https://us-central1-nocturne-87c33.cloudfunctions.net/generateGoalFromDream',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dreamText: val }),
      }
    );
    if (!response.ok) throw new Error('Failed to fetch goal');
    const data = await response.json();
    console.log('Generated Goal:', data.goal);
    setSelectedGoal(data.goal);
  } catch (error) {
    console.error('Error generating goal:', error);
  }
};
