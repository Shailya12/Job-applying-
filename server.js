const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const Anthropic = require('@anthropic-ai/sdk');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Paths
const DATA_DIR = path.join(__dirname, 'data');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const BASE_RESUME_FILE = path.join(DATA_DIR, 'base_resume.md');
const SKILLS_DIR = path.join(__dirname, '.gemini', 'skills');

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helpers for reading/writing files
const readJobs = () => {
  try {
    if (!fs.existsSync(JOBS_FILE)) {
      fs.writeFileSync(JOBS_FILE, JSON.stringify([], null, 2));
      return [];
    }
    return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
  } catch (err) {
    console.error('Error reading jobs database:', err);
    return [];
  }
};

const writeJobs = (jobs) => {
  try {
    fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
    return true;
  } catch (err) {
    console.error('Error writing jobs database:', err);
    return false;
  }
};

const readBaseResume = () => {
  try {
    if (!fs.existsSync(BASE_RESUME_FILE)) {
      return '';
    }
    return fs.readFileSync(BASE_RESUME_FILE, 'utf8');
  } catch (err) {
    console.error('Error reading base resume:', err);
    return '';
  }
};

// Helper to load skill content
const loadSkill = (skillName) => {
  try {
    const skillPath = path.join(SKILLS_DIR, skillName, 'SKILL.md');
    if (fs.existsSync(skillPath)) {
      return fs.readFileSync(skillPath, 'utf8');
    }
    return '';
  } catch (err) {
    console.error(`Error loading skill ${skillName}:`, err);
    return '';
  }
};

// --- API Endpoints ---

// 1. GET base resume
app.get('/api/base-resume', (req, res) => {
  const resume = readBaseResume();
  res.json({ content: resume });
});

// 2. POST update base resume
app.post('/api/base-resume', (req, res) => {
  const { content } = req.body;
  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }
  try {
    fs.writeFileSync(BASE_RESUME_FILE, content);
    res.json({ success: true, message: 'Base resume updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save base resume' });
  }
});

// 3. GET all jobs
app.get('/api/jobs', (req, res) => {
  const jobs = readJobs();
  res.json(jobs);
});

// 4. POST add a new job
app.post('/api/jobs', (req, res) => {
  const { company, role, dateApplied, status, jd, link } = req.body;
  if (!company || !role) {
    return res.status(400).json({ error: 'Company and Role are required' });
  }

  const jobs = readJobs();
  const newJob = {
    id: Date.now().toString(),
    company,
    role,
    dateApplied: dateApplied || new Date().toISOString().split('T')[0],
    status: status || 'Applied',
    jd: jd || '',
    link: link || '',
    matchScore: null,
    analysis: null,
    tailoredResume: null,
    interviewPrep: null
  };

  jobs.push(newJob);
  writeJobs(jobs);
  res.status(201).json(newJob);
});

// 5. PUT update job details
app.put('/api/jobs/:id', (req, res) => {
  const { id } = req.params;
  const updateData = req.body;
  
  const jobs = readJobs();
  const index = jobs.findIndex(j => j.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Merge updates
  jobs[index] = { ...jobs[index], ...updateData };
  writeJobs(jobs);
  res.json(jobs[index]);
});

// 6. DELETE a job
app.delete('/api/jobs/:id', (req, res) => {
  const { id } = req.params;
  const jobs = readJobs();
  const filtered = jobs.filter(j => j.id !== id);
  
  if (jobs.length === filtered.length) {
    return res.status(404).json({ error: 'Job not found' });
  }

  writeJobs(filtered);
  res.json({ success: true, message: 'Job deleted successfully' });
});

// 7. GET list of available skills
app.get('/api/skills', (req, res) => {
  try {
    if (!fs.existsSync(SKILLS_DIR)) {
      return res.json([]);
    }
    const skillDirs = fs.readdirSync(SKILLS_DIR).filter(file => {
      return fs.statSync(path.join(SKILLS_DIR, file)).isDirectory();
    });

    const skills = skillDirs.map(name => {
      const skillFile = path.join(SKILLS_DIR, name, 'SKILL.md');
      let description = 'AI skill for resume / career optimization';
      if (fs.existsSync(skillFile)) {
        const content = fs.readFileSync(skillFile, 'utf8');
        const descMatch = content.match(/description:\s*(.*)/i);
        if (descMatch && descMatch[1]) {
          description = descMatch[1].trim();
        }
      }
      return { name, description };
    });

    res.json(skills);
  } catch (err) {
    console.error('Error fetching skills list:', err);
    res.status(500).json({ error: 'Failed to retrieve skills list' });
  }
});

// 8. GET skill detail content
app.get('/api/skills/:name', (req, res) => {
  const { name } = req.params;
  const content = loadSkill(name);
  if (!content) {
    return res.status(404).json({ error: 'Skill not found' });
  }
  res.json({ name, content });
});

// Helper: Safely parse JSON from Claude's response
function cleanAndParseJSON(text) {
  try {
    // Try standard parsing
    return JSON.parse(text.trim());
  } catch (e) {
    // Look for JSON block ```json ... ``` or ``` ... ```
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch (innerError) {
        console.error("Failed parsing JSON block:", innerError);
      }
    }
    
    // Look for first occurrence of [ or { and last occurrence of ] or }
    const firstObject = text.indexOf('{');
    const firstArray = text.indexOf('[');
    const lastObject = text.lastIndexOf('}');
    const lastArray = text.lastIndexOf(']');
    
    let start = -1;
    let end = -1;
    
    if (firstObject !== -1 && (firstArray === -1 || firstObject < firstArray)) {
      start = firstObject;
      end = lastObject;
    } else if (firstArray !== -1) {
      start = firstArray;
      end = lastArray;
    }
    
    if (start !== -1 && end !== -1 && end > start) {
      const candidate = text.substring(start, end + 1);
      try {
        return JSON.parse(candidate);
      } catch (innerError) {
        console.error("Failed parsing extracted bracket content:", innerError);
      }
    }
    
    throw new Error("Could not extract valid JSON from response");
  }
}

// Helper: Sanitize strings to prevent API key leaks
const sanitizeApiKey = (text) => {
  if (typeof text !== 'string') return text;
  return text.replace(/sk-ant-[a-zA-Z0-9_-]+/g, '[REDACTED_API_KEY]');
};

// Helper: Log error securely by removing any possible API keys
const logSecureError = (label, err) => {
  const message = err && err.message ? err.message : String(err);
  const stack = err && err.stack ? err.stack : '';
  console.error(`${label} ${sanitizeApiKey(message)}`, sanitizeApiKey(stack));
};

// Helper: Get Anthropic client using the key from the request header (or environment fallback)
const getAnthropicClient = (req) => {
  const apiKey = req.headers['x-api-key'] || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Anthropic API Key is missing. Please configure your key in Settings first.');
  }
  return new Anthropic({ apiKey });
};

// 9. POST Analyze Job Description (Match score + gap analysis)
app.post('/api/analyze-jd', async (req, res) => {
  const { jd, company, role, model } = req.body;
  if (!jd) {
    return res.status(400).json({ error: 'Job description is required' });
  }

  const baseResume = readBaseResume();
  const jdSkill = loadSkill('job-description-analyzer');
  const atsSkill = loadSkill('resume-ats-optimizer');

  if (!baseResume) {
    return res.status(400).json({ error: 'Please set your Base Resume in settings first!' });
  }

  try {
    const client = getAnthropicClient(req);
    const selectedModel = model || 'claude-haiku-4-5-20251001';

    const systemPrompt = `You are an expert ATS (Applicant Tracking System) recruiter and Career Coach. 
Analyze the job description (JD) against the user's base resume.
You MUST refer to the following skills to guide your analysis:
1. Job Description Analyzer Skill:
${jdSkill}

2. Resume ATS Optimizer Skill:
${atsSkill}

Your output must be a valid JSON object only. Do not wrap in markdown or add notes. Use this exact schema:
{
  "matchScore": number (0 to 100 representing percentage match),
  "recommendation": "string (e.g. STRONG FIT, GOOD FIT, WEAK FIT - with guidance)",
  "priority": "string (HIGH, MEDIUM, LOW)",
  "requiredSkills": [
    { "skill": "string", "matched": boolean, "details": "string explaining why or what is missing" }
  ],
  "preferredSkills": [
    { "skill": "string", "matched": boolean, "details": "string explaining why or what is missing" }
  ],
  "strengths": ["string", "string"],
  "gaps": ["string", "string"],
  "tailoringStrategy": "string summarizing how to focus the resume for this JD"
}`;

    const userPrompt = `Company: ${company || 'Unknown'}
Role: ${role || 'Unknown'}

Job Description:
${jd}

User Base Resume:
${baseResume}`;

    const response = await client.messages.create({
      model: selectedModel,
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const parsedResult = cleanAndParseJSON(response.content[0].text);
    res.json(parsedResult);
  } catch (err) {
    logSecureError('Claude JD Analysis error:', err);
    res.status(500).json({ error: 'AI analysis failed: ' + sanitizeApiKey(err.message) });
  }
});

// 10. POST Tailor Resume (Strictly 1-page structured JSON output)
app.post('/api/tailor-resume', async (req, res) => {
  const { jd, company, role, model } = req.body;
  if (!jd) {
    return res.status(400).json({ error: 'Job description is required' });
  }

  const baseResume = readBaseResume();
  const resumeTailor = loadSkill('resume-tailor');
  const bulletWriter = loadSkill('resume-bullet-writer');
  const quantifier = loadSkill('resume-quantifier');
  const atsOptimizer = loadSkill('resume-ats-optimizer');
  const techOptimizer = loadSkill('tech-resume-optimizer');

  if (!baseResume) {
    return res.status(400).json({ error: 'Please set your Base Resume in settings first!' });
  }

  try {
    const client = getAnthropicClient(req);
    const selectedModel = model || 'claude-haiku-4-5-20251001';

    const systemPrompt = `You are an elite Resume Writer and Career Coach specializing in AI product management, coordination, and tech positions.
Your task is to tailor the user's base resume specifically to the provided Job Description (JD).

CRITICAL RULE: The tailored resume MUST fit on exactly one page. Keep descriptions, achievements, and lists concise and focused. Remove unrelated experience or details. Do not fabricate experience. Rephrase existing items to highlight JD keywords.

You MUST read and strictly implement the guidelines from these 5 career skills:
1. Resume Tailoring Skill:
${resumeTailor}

2. Resume Bullet Writer Skill (focusing on high-impact verbs and results):
${bulletWriter}

3. Resume Quantifier Skill (always adding metric outcomes like %, $, time saved, users scaled):
${quantifier}

4. Resume ATS Optimizer Skill (matching JD keywords naturally):
${atsOptimizer}

5. Tech Resume Optimizer Skill (formatting for AI and PM roles):
${techOptimizer}

When writing the tailored resume:
- Professional Summary: Re-write to focus exactly on the core skills, industries, and experiences requested in the JD. Mirror their key requirements (e.g. if they request LLM prompting, stakeholder management, or product roadmapping, start with those).
- Bullet Points: For Noesis.tech (Product Manager / Project Coordinator) and Prompt Intern, use the bullet structures from Bullet Writer & Quantifier skills. Each bullet should be: [Action Verb] + [Context/Project] + [Quantified Result]. Do not just list tasks; explain the "so what" and add numbers (e.g., coordinates 4+ products, managed 12 developers, increased throughput by 20%, resolved 3+ major chatbot rollout conflicts, etc.).
- Skills: Put the most relevant keywords at the beginning of the core, technical, and tools arrays matching the JD.
- Education & Projects: Highlight components most relevant to the JD.

Your output must be a valid JSON object matching this schema. Output ONLY the JSON:
{
  "name": "SHAILYA GOHIL",
  "contact": {
    "location": "Mumbai, India",
    "phone": "+91 9820087991",
    "email": "shailyak12@gmail.com",
    "linkedin": "https://linkedin.com/in/shailyagohil"
  },
  "summary": "A tailored 3-4 sentence professional summary aligned directly with the JD keywords",
  "education": [
    { "institution": "string", "location": "string", "degree": "string", "dates": "string" }
  ],
  "skills": {
    "core": ["string", "string"],
    "technical": ["string", "string"],
    "tools": ["string", "string"]
  },
  "experience": [
    {
      "company": "string",
      "location": "string",
      "role": "string",
      "dates": "string",
      "bullets": [
        "Concise achievement bullet (limit to 3-4 bullets total per role)",
        "Bullet incorporating JD requirements and clear metrics/business impact where possible"
      ]
    }
  ],
  "projects": [
    {
      "title": "string",
      "details": "One line summary of project focusing on skills relevant to this JD"
    }
  ]
}`;

    const userPrompt = `Company: ${company || 'Unknown'}
Role: ${role || 'Unknown'}

Job Description:
${jd}

Base Resume:
${baseResume}`;

    const response = await client.messages.create({
      model: selectedModel,
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const parsedResult = cleanAndParseJSON(response.content[0].text);
    res.json(parsedResult);
  } catch (err) {
    logSecureError('Claude Resume Tailoring error:', err);
    res.status(500).json({ error: 'AI tailoring failed: ' + sanitizeApiKey(err.message) });
  }
});

// 11. GET/POST verify connection
app.all('/api/test-claude', async (req, res) => {
  const apiKey = req.headers['x-api-key'] || req.body.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.json({ status: 'inactive', hasKey: false });
  }

  try {
    const tempAnthropic = new Anthropic({ apiKey });
    await tempAnthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'Ping' }]
    });
    res.json({ status: 'active', hasKey: true, verified: true });
  } catch (err) {
    res.json({ status: 'error', hasKey: true, verified: false, error: sanitizeApiKey(err.message) });
  }
});

// 12. POST Generate Interview Prep Q&A (STAR format)
app.post('/api/generate-prep', async (req, res) => {
  const { jd, company, role, model } = req.body;
  if (!jd) {
    return res.status(400).json({ error: 'Job description is required' });
  }

  const baseResume = readBaseResume();
  const prepSkill = loadSkill('interview-prep-generator');

  if (!baseResume) {
    return res.status(400).json({ error: 'Please set your Base Resume in settings first!' });
  }

  try {
    const client = getAnthropicClient(req);
    const selectedModel = model || 'claude-haiku-4-5-20251001';

    const systemPrompt = `You are an elite Interview Coach. 
Analyze the job description and the user's base resume. Generate exactly 10 interview preparation questions and answers tailored to this role.
Use the STAR method (Situation, Task, Action, Result) for behavioral answers.

Refer to the Interview Prep Generator skill:
${prepSkill}

Your output must be a valid JSON array only. Output ONLY the JSON array matching this schema:
[
  {
    "id": number (1 to 10),
    "type": "string (Behavioral, Technical, or Core/Product Management)",
    "question": "string containing the interview question",
    "answer": {
      "situation": "string context based on the user's real experience in their resume",
      "task": "string role/ownership description",
      "action": "string detailed actions taken",
      "result": "string outcome with metrics where possible"
    },
    "tips": "string containing coaching tips on how to deliver this answer effectively"
  }
]`;

    const userPrompt = `Company: ${company || 'Unknown'}
Role: ${role || 'Unknown'}

Job Description:
${jd}

User Base Resume:
${baseResume}`;

    const response = await client.messages.create({
      model: selectedModel,
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const parsedResult = cleanAndParseJSON(response.content[0].text);
    res.json(parsedResult);
  } catch (err) {
    logSecureError('Claude Prep Generation error:', err);
    res.status(500).json({ error: 'AI prep generation failed: ' + sanitizeApiKey(err.message) });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running locally on http://localhost:${PORT}`);
});
