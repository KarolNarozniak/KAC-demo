const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000') + '/api/v1';

export type BlockType = 'vacation' | 'exam_session' | 'day_off';

export type Block = {
  id: string;
  userId: string;
  title: string;
  startTime: string;
  endTime: string;
  type: BlockType;
};

export type BlockInput = {
  title: string;
  startTime: string;
  endTime: string;
  type: BlockType;
};

export async function fetchBlocks(): Promise<Block[]> {
  const response = await fetch(`${API_URL}/blocks`);
  if (!response.ok) throw new Error('Nie udało się pobrać blokad');
  return response.json();
}

export async function createBlock(input: BlockInput): Promise<Block> {
  const response = await fetch(`${API_URL}/blocks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({...input,startTime:new Date(input.startTime).toISOString(),endTime:new Date(input.endTime).toISOString()}),
  });
  if (!response.ok) throw new Error('Nie udało się utworzyć blokady');
  return response.json();
}

export async function deleteBlock(id: string): Promise<void> {
  const response = await fetch(`${API_URL}/blocks/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Nie udało się usunąć blokady');
}