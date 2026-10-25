import { CandidateProfile, JobRecord } from "@/types/jobpilot";

export const INITIAL_CANDIDATE_PROFILE: CandidateProfile = {
  fullName: "Aarav Mehta",
  email: "aarav.mehta@example.com",
  phone: "+91 98765 43210",
  preferredRole: "Senior Full-Stack AI Engineer",
  preferredLocation: "Bengaluru, India (Hybrid / Remote)",
  yearsOfExperience: "4.5 Years",
  experienceSummary:
    "Full-stack software engineer with 4.5 years of experience building TypeScript/Next.js web applications, Python FastAPI microservices, and LLM-powered workflow tools with PostgreSQL and Supabase.",
  education: "B.Tech in Computer Science & Engineering, NIT Trichy (2021)",
  skills: [
    "TypeScript",
    "React",
    "Next.js",
    "Tailwind CSS",
    "Python",
    "FastAPI",
    "PostgreSQL",
    "Supabase",
    "Docker",
    "REST APIs",
    "LLM Orchestration",
    "Git",
  ],
  employmentHistory: [
    {
      title: "Senior Software Engineer",
      role: "Senior Software Engineer",
      company: "CloudScale Systems",
      duration: "2023 - Present",
      highlights: [
        "Architected full-stack human-in-the-loop AI workflow dashboards using Next.js, TypeScript, and Python FastAPI.",
        "Scaled multi-tenant PostgreSQL and Supabase pipelines serving enterprise customers.",
      ],
    },
    {
      title: "Software Engineer",
      role: "Software Engineer",
      company: "DataPulse Tech",
      duration: "2021 - 2023",
      highlights: [
        "Built React and TypeScript developer portals and REST API integrations.",
      ],
    },
  ],
  educationEntries: [
    {
      degree: "B.Tech in Computer Science & Engineering",
      institution: "NIT Trichy",
      year: "2021",
    },
  ],
  certifications: ["AWS Certified Developer - Associate"],
  projects: [
    {
      name: "JobPilot Workflow Engine",
      description:
        "Built a deterministic resume matcher and human-approved application workspace with Next.js and FastAPI.",
      technologies: ["TypeScript", "Next.js", "Python", "FastAPI", "PostgreSQL"],
    },
  ],
  workAuthorization: "Authorized to work in India",
  noticePeriod: "30 days",
  portfolioOrGithubUrl: "https://github.com/aaravmehta-dev",
  resumeFile: {
    fileName: "Aarav_Mehta_Senior_FullStack_Resume_2026.pdf",
    fileSize: 248320,
    uploadedAt: "2026-10-20T10:15:00Z",
    uploadStatus: "Uploaded (Local Prototype Storage)",
  },
  updatedAt: "2026-10-24T14:30:00Z",
};

export const INITIAL_JOBS: JobRecord[] = [
  {
    id: "job-101",
    title: "Senior Full-Stack Engineer (AI Workflows)",
    company: "LinearStack Labs",
    location: "Bengaluru, Karnataka",
    workMode: "Hybrid",
    salary: "₹32L – ₹45L PA",
    experience: "4 - 6 years",
    requiredSkills: [
      "TypeScript",
      "Next.js",
      "React",
      "Python",
      "FastAPI",
      "PostgreSQL",
      "Tailwind CSS",
      "Redis",
    ],
    matchedSkills: [
      "TypeScript",
      "Next.js",
      "React",
      "Python",
      "FastAPI",
      "PostgreSQL",
      "Tailwind CSS",
    ],
    missingSkills: ["Redis"],
    source: "LinkedIn",
    applicationUrl: "https://www.linkedin.com/jobs/view/example-linearstack-101",
    description:
      "LinearStack Labs is looking for a Senior Full-Stack Engineer to lead our human-in-the-loop AI workflow platform. You will architect responsive Next.js interfaces, design resilient Python FastAPI services, and scale multi-tenant PostgreSQL data pipelines. Experience with Redis caching and LLM tool-use is a strong plus.",
    matchScore: 91,
    matchSummary:
      "Mock Match Assessment: 7 of 8 required skills match your profile directly (TypeScript, Next.js, React, Python, FastAPI, PostgreSQL, Tailwind CSS). Consider highlighting any caching or queue experience to cover Redis.",
    status: "Awaiting Approval",
    reviewState: "Draft",
    verificationState: "Source URL Provided",
    verificationNote:
      "User-supplied LinkedIn posting URL recorded. Independent live company verification requires the FastAPI backend integration.",
    sourceLinks: [
      {
        label: "Submitted Job Posting URL (LinkedIn)",
        url: "https://www.linkedin.com/jobs/view/example-linearstack-101",
        note: "Provided at job intake; verify on original portal before applying.",
      },
    ],
    createdAt: "2026-10-24T09:10:00Z",
    updatedAt: "2026-10-24T11:25:00Z",
    questionsAndAnswers: [
      {
        id: "qa-101-1",
        category: "Motivation",
        question: "Why do you want to join LinearStack Labs in this Senior Full-Stack role?",
        answer:
          "I have spent the last 4.5 years building full-stack products with Next.js, TypeScript, and Python FastAPI, with a focus on human-in-the-loop AI interfaces. LinearStack Labs' mission to build reliable enterprise AI workflows aligns directly with my hands-on experience designing structured review dashboards and multi-tenant PostgreSQL backends.",
      },
      {
        id: "qa-101-2",
        category: "Experience",
        question: "Describe a production system you built using Next.js and Python/FastAPI.",
        answer:
          "At my current team, I architected a document workflow portal using Next.js App Router and Tailwind CSS on the frontend paired with an asynchronous Python FastAPI service and Supabase/PostgreSQL. It reduced manual review turnaround time by 42% while keeping human approval checkpoints for every external action.",
      },
      {
        id: "qa-101-3",
        category: "Logistics",
        question: "What is your notice period and preferred work arrangement in Bengaluru?",
        answer:
          "I am based in Bengaluru and comfortable with a 3-day hybrid schedule. My current notice period is 30 days, with potential for an earlier transition upon handover completion.",
      },
    ],
    outreach: {
      recruiterName: "Priya Nair",
      recruiterTitle: "Senior Technical Recruiter, LinearStack Labs",
      recruiterEmail: "priya.nair@linearstack.example.com",
      recruiterPhoneOrWhatsApp: "+91 98201 11223",
      emailSubject: "Application: Senior Full-Stack Engineer (AI Workflows) — Aarav Mehta",
      emailBody: `Hi Priya,

I hope your week is going well. I noticed the Senior Full-Stack Engineer (AI Workflows) opening at LinearStack Labs and wanted to share my background.

Over the past 4.5 years, I have built production SaaS applications using Next.js, TypeScript, Tailwind CSS, Python FastAPI, and PostgreSQL/Supabase. I enjoy building intuitive, human-in-the-loop AI products and would love to bring this experience to the LinearStack engineering team.

I have attached my resume for your review. Would you be open to a brief 10-minute chat this week?

Best regards,
Aarav Mehta
+91 98765 43210
https://github.com/aaravmehta-dev`,
      whatsappMessage:
        "Hi Priya, this is Aarav Mehta. I came across the Senior Full-Stack Engineer (AI Workflows) role at LinearStack Labs. I have 4.5 years of experience in Next.js, TypeScript, Python FastAPI & PostgreSQL. I'd love to share my resume and learn more when convenient—thank you!",
      lastUpdatedAt: "2026-10-24T11:25:00Z",
    },
  },
  {
    id: "job-102",
    title: "Staff Frontend Product Engineer",
    company: "FinVerse Systems",
    location: "Mumbai / Remote",
    workMode: "Remote",
    salary: "₹36L – ₹50L PA",
    experience: "4 - 7 years",
    requiredSkills: [
      "React",
      "TypeScript",
      "Next.js",
      "Tailwind CSS",
      "Design Systems",
      "Accessibility (WCAG)",
    ],
    matchedSkills: ["React", "TypeScript", "Next.js", "Tailwind CSS"],
    missingSkills: ["Design Systems", "Accessibility (WCAG)"],
    source: "Company Website",
    applicationUrl: "https://careers.finverse.example.com/openings/staff-frontend-102",
    description:
      "FinVerse Systems is hiring a Staff Frontend Product Engineer to own our customer-facing treasury dashboard. You will work closely with product designers to craft accessible, high-density financial data tables and workflows in Next.js and TypeScript.",
    matchScore: 84,
    matchSummary:
      "Mock Match Assessment: Strong core alignment on React, TypeScript, Next.js, and Tailwind CSS. Explicitly adding accessibility (WCAG) and component library ownership to your profile will strengthen this application.",
    status: "Approved",
    reviewState: "Approved",
    verificationState: "Source URL Provided",
    verificationNote:
      "Direct careers page URL provided by user. Automated domain ownership verification is not active in prototype mode.",
    sourceLinks: [
      {
        label: "Submitted Careers Page URL",
        url: "https://careers.finverse.example.com/openings/staff-frontend-102",
        note: "User-entered company portal link.",
      },
    ],
    createdAt: "2026-10-22T14:00:00Z",
    updatedAt: "2026-10-23T16:40:00Z",
    approvedAt: "2026-10-23T16:40:00Z",
    questionsAndAnswers: [
      {
        id: "qa-102-1",
        category: "Motivation",
        question: "What excites you about building financial interfaces at FinVerse Systems?",
        answer:
          "Financial interfaces require clarity, speed, and zero ambiguity around state changes. I enjoy crafting keyboard-accessible, high-density dashboards in Next.js and TypeScript where users can audit complex data with confidence.",
      },
      {
        id: "qa-102-2",
        category: "Experience",
        question: "How do you approach frontend accessibility and reusable component architecture?",
        answer:
          "I build components with semantic HTML, ARIA attributes, focus rings, and strict TypeScript props from day one, ensuring every modal, filter, and form workflow works seamlessly via keyboard and screen readers.",
      },
    ],
    outreach: {
      recruiterName: "Rohan Kulkarni",
      recruiterTitle: "Engineering Talent Partner, FinVerse Systems",
      recruiterEmail: "rohan.k@finverse.example.com",
      recruiterPhoneOrWhatsApp: "+91 98111 22334",
      emailSubject: "Staff Frontend Product Engineer Application — Aarav Mehta",
      emailBody: `Hi Rohan,

I recently prepared my application for the Staff Frontend Product Engineer position at FinVerse Systems. With 4.5 years of experience architecting TypeScript and Next.js SaaS platforms, I am excited about helping scale FinVerse's treasury dashboard.

Please let me know if I can provide any additional context or code samples.

Best,
Aarav Mehta`,
      whatsappMessage:
        "Hi Rohan, Aarav Mehta here. I'm applying for the Staff Frontend Product Engineer role at FinVerse Systems (4.5 yrs Next.js / TypeScript experience). Happy to share my portfolio or connect briefly!",
      lastUpdatedAt: "2026-10-23T16:40:00Z",
    },
  },
  {
    id: "job-103",
    title: "AI Platform Engineer (Python & FastAPI)",
    company: "NovaPulse Health AI",
    location: "Hyderabad, Telangana",
    workMode: "Hybrid",
    salary: "₹28L – ₹38L PA",
    experience: "3 - 5 years",
    requiredSkills: [
      "Python",
      "FastAPI",
      "PostgreSQL",
      "Supabase",
      "Docker",
      "LLM Orchestration",
      "Kubernetes",
    ],
    matchedSkills: [
      "Python",
      "FastAPI",
      "PostgreSQL",
      "Supabase",
      "Docker",
      "LLM Orchestration",
    ],
    missingSkills: ["Kubernetes"],
    source: "Naukri",
    applicationUrl: "https://www.naukri.com/job-listings-novapulse-health-ai-103",
    description:
      "Join NovaPulse Health AI to build secure clinical document intake and triage pipelines using Python, FastAPI, PostgreSQL, and containerised deployment workflows. All outputs require clinician sign-off.",
    matchScore: 88,
    matchSummary:
      "Mock Match Assessment: 6 of 7 skills match your profile (Python, FastAPI, PostgreSQL, Supabase, Docker, LLM Orchestration). Kubernetes is the only gap listed.",
    status: "Interview",
    reviewState: "Submitted",
    verificationState: "Source URL Provided",
    verificationNote:
      "Naukri listing URL recorded at intake. User manually confirmed recruiter response.",
    sourceLinks: [
      {
        label: "Submitted Naukri Listing URL",
        url: "https://www.naukri.com/job-listings-novapulse-health-ai-103",
        note: "User-supplied Naukri job link.",
      },
    ],
    createdAt: "2026-10-16T08:30:00Z",
    updatedAt: "2026-10-21T15:00:00Z",
    approvedAt: "2026-10-17T09:00:00Z",
    submittedAt: "2026-10-17T09:15:00Z",
    questionsAndAnswers: [
      {
        id: "qa-103-1",
        category: "Experience",
        question: "Share your experience designing FastAPI services and PostgreSQL schemas.",
        answer:
          "I have built multiple async FastAPI services backed by PostgreSQL and Supabase with strict Pydantic validation, row-level security, and structured audit logging for human approval workflows.",
      },
    ],
    outreach: {
      recruiterName: "Sneha Reddy",
      recruiterTitle: "Talent Acquisition Lead, NovaPulse Health AI",
      recruiterEmail: "sneha.reddy@novapulse.example.com",
      recruiterPhoneOrWhatsApp: "+91 97001 44556",
      emailSubject: "Following up: Technical Round Schedule — Aarav Mehta (AI Platform Engineer)",
      emailBody: `Hi Sneha,

Thank you for scheduling the upcoming technical interview for the AI Platform Engineer role at NovaPulse Health AI. Looking forward to speaking with the engineering panel on Tuesday.

Warm regards,
Aarav Mehta`,
      whatsappMessage:
        "Hi Sneha, Aarav Mehta here. Confirming receipt of the calendar invite for the AI Platform Engineer interview at NovaPulse Health AI. Thank you!",
      lastUpdatedAt: "2026-10-21T15:00:00Z",
    },
  },
  {
    id: "job-104",
    title: "Product Engineer — Developer Tools",
    company: "CloudForge Dev",
    location: "Remote (India)",
    workMode: "Remote",
    salary: "₹30L – ₹42L PA",
    experience: "3 - 6 years",
    requiredSkills: [
      "TypeScript",
      "Next.js",
      "React",
      "REST APIs",
      "Git",
      "GraphQL",
    ],
    matchedSkills: ["TypeScript", "Next.js", "React", "REST APIs", "Git"],
    missingSkills: ["GraphQL"],
    source: "LinkedIn",
    applicationUrl: "https://www.linkedin.com/jobs/view/example-cloudforge-104",
    description:
      "CloudForge Dev builds CI/CD observability dashboards for modern engineering teams. We need a Product Engineer comfortable working across Next.js, TypeScript, REST/GraphQL APIs, and developer CLI integrations.",
    matchScore: 83,
    matchSummary:
      "Mock Match Assessment: 5 of 6 required skills match. GraphQL is listed in the posting but not currently in your profile skills list.",
    status: "Submitted",
    reviewState: "Submitted",
    verificationState: "Source URL Provided",
    verificationNote:
      "LinkedIn posting URL recorded. Marked as manually submitted by user after approval.",
    sourceLinks: [
      {
        label: "Submitted Job Posting URL (LinkedIn)",
        url: "https://www.linkedin.com/jobs/view/example-cloudforge-104",
        note: "Provided by user.",
      },
    ],
    createdAt: "2026-10-18T11:20:00Z",
    updatedAt: "2026-10-19T18:10:00Z",
    approvedAt: "2026-10-19T17:50:00Z",
    submittedAt: "2026-10-19T18:10:00Z",
    questionsAndAnswers: [
      {
        id: "qa-104-1",
        category: "Motivation",
        question: "Why developer tools?",
        answer:
          "Developer tools have a tight feedback loop—every improvement in observability and ergonomics saves hours for engineering teams.",
      },
    ],
    outreach: {
      recruiterName: "Vikram Desai",
      recruiterTitle: "Engineering Manager, CloudForge Dev",
      recruiterEmail: "vikram@cloudforge.example.com",
      recruiterPhoneOrWhatsApp: "+91 98450 66778",
      emailSubject: "Submitted Application: Product Engineer (Developer Tools) — Aarav Mehta",
      emailBody: `Hi Vikram,

I recently submitted my application for the Product Engineer — Developer Tools role at CloudForge Dev. As someone who builds daily with TypeScript, Next.js, and Python microservices, I'd love to contribute to CloudForge's developer experience.

Best regards,
Aarav Mehta`,
      whatsappMessage:
        "Hi Vikram, Aarav Mehta here. Just applied for the Product Engineer role at CloudForge Dev and wanted to say hello!",
      lastUpdatedAt: "2026-10-19T18:10:00Z",
    },
  },
  {
    id: "job-105",
    title: "Founding Full-Stack Engineer",
    company: "Stealth Quant AI (Screenshot Upload)",
    location: "Bengaluru, Karnataka",
    workMode: "On-site",
    salary: "₹25L – ₹40L PA + Equity",
    experience: "3+ years",
    requiredSkills: ["TypeScript", "React", "Python", "FastAPI", "PostgreSQL", "AWS"],
    matchedSkills: ["TypeScript", "React", "Python", "FastAPI", "PostgreSQL"],
    missingSkills: ["AWS"],
    source: "Other",
    applicationUrl: "",
    description:
      "Captured from job screenshot shared in founder community: Hiring a Founding Full-Stack Engineer in Bengaluru (HSR Layout) to build our analytics workbench in React, TypeScript, Python FastAPI, and PostgreSQL.",
    matchScore: 79,
    matchSummary:
      "Mock Match Assessment: Strong 5/6 technical skill overlap, though the role is 5-day On-site vs. your Hybrid/Remote preference and no direct application URL was supplied.",
    status: "Saved",
    reviewState: "Draft",
    verificationState: "Unverified (Screenshot / Text Only)",
    verificationNote:
      "No official company URL or domain was provided with this screenshot entry. Verify company identity and official careers portal before sharing personal documents.",
    sourceLinks: [],
    uploadedFileName: "founder_slack_post_screenshot.png",
    uploadedFileSize: 184200,
    createdAt: "2026-10-24T16:05:00Z",
    updatedAt: "2026-10-24T16:05:00Z",
    questionsAndAnswers: [
      {
        id: "qa-105-1",
        category: "Motivation",
        question: "Interest in Founding Engineer role and on-site availability",
        answer:
          "I enjoy 0-to-1 product engineering across React/TypeScript and FastAPI/PostgreSQL. Before proceeding, I would like to learn more about the product roadmap and hybrid flexibility in HSR Layout.",
      },
    ],
    outreach: {
      recruiterName: "Hiring Team / Founder",
      recruiterTitle: "Founder, Stealth Quant AI",
      recruiterEmail: "",
      recruiterPhoneOrWhatsApp: "",
      emailSubject: "Inquiry: Founding Full-Stack Engineer Role — Aarav Mehta",
      emailBody: `Hi there,

I saw your post regarding the Founding Full-Stack Engineer role in Bengaluru. My background spans 4.5 years across TypeScript, React, Next.js, Python FastAPI, and PostgreSQL.

Could you share the official company website and role overview so we can connect further?

Best regards,
Aarav Mehta`,
      whatsappMessage:
        "Hi! Saw your Founding Full-Stack Engineer post for Bengaluru. I have 4.5 yrs experience in React, TypeScript & Python FastAPI. Would love to learn more about the company and role!",
      lastUpdatedAt: "2026-10-24T16:05:00Z",
    },
  },
  {
    id: "job-106",
    title: "Lead Backend Distributed Systems Engineer",
    company: "ScaleGrid Commerce",
    location: "Gurugram, Haryana",
    workMode: "Hybrid",
    salary: "₹45L – ₹60L PA",
    experience: "6 - 9 years",
    requiredSkills: ["Go", "Kafka", "Kubernetes", "PostgreSQL", "Docker", "Microservices"],
    matchedSkills: ["PostgreSQL", "Docker"],
    missingSkills: ["Go", "Kafka", "Kubernetes", "Microservices"],
    source: "Naukri",
    applicationUrl: "https://www.naukri.com/job-listings-scalegrid-commerce-106",
    description:
      "Looking for a 6+ year Lead Backend Engineer specialising in high-throughput Go microservices, Apache Kafka event streaming, and multi-region Kubernetes clusters.",
    matchScore: 46,
    matchSummary:
      "Mock Match Assessment: Low match (46%). The role requires 6–9 years of experience and primary expertise in Go, Kafka, and Kubernetes, whereas your profile focuses on Full-Stack TypeScript/Next.js and Python/FastAPI.",
    status: "Rejected",
    reviewState: "Submitted",
    verificationState: "Source URL Provided",
    verificationNote:
      "Naukri job URL provided. Application closed by employer due to primary Go/Kafka requirement.",
    sourceLinks: [
      {
        label: "Submitted Naukri Listing URL",
        url: "https://www.naukri.com/job-listings-scalegrid-commerce-106",
        note: "User-supplied Naukri job link.",
      },
    ],
    createdAt: "2026-10-10T10:00:00Z",
    updatedAt: "2026-10-15T12:00:00Z",
    approvedAt: "2026-10-10T11:00:00Z",
    submittedAt: "2026-10-10T11:30:00Z",
    questionsAndAnswers: [
      {
        id: "qa-106-1",
        category: "Experience",
        question: "Backend systems experience",
        answer:
          "While my primary backend stack is Python FastAPI and PostgreSQL, I have strong fundamentals in distributed data modelling and containerised deployments.",
      },
    ],
    outreach: {
      recruiterName: "Talent Team",
      recruiterTitle: "Recruiting, ScaleGrid Commerce",
      recruiterEmail: "careers@scalegrid.example.com",
      recruiterPhoneOrWhatsApp: "",
      emailSubject: "Application Inquiry: Lead Backend Engineer — Aarav Mehta",
      emailBody: `Hello ScaleGrid Recruiting Team,

Thank you for reviewing my profile for the Lead Backend Engineer role. Wishing the team the best with the search, and I hope to stay in touch for future Full-Stack or AI Platform roles.

Best regards,
Aarav Mehta`,
      whatsappMessage:
        "Hello ScaleGrid team, thank you for the update on my application. Please keep me in mind for future Full-Stack / Python AI roles!",
      lastUpdatedAt: "2026-10-15T12:00:00Z",
    },
  },
];
