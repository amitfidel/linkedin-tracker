// Curated dictionary of cybersecurity and tech terms for keyword extraction from job descriptions
export const CYBER_KEYWORDS = [
  // Security domains
  "SIEM", "SOAR", "SOC", "EDR", "XDR", "MDR", "NDR", "CASB", "CSPM", "CWPP",
  "CNAPP", "ASM", "EASM", "DSPM", "DLP", "IAM", "PAM", "CIEM", "WAF", "NGFW",
  "IDS", "IPS", "ZTNA", "Zero Trust", "SASE", "SSE", "DevSecOps",
  "threat intelligence", "incident response", "penetration testing", "red team",
  "blue team", "purple team", "threat hunting", "vulnerability management",
  "cloud security", "application security", "network security", "endpoint security",
  "identity security", "data security", "API security", "container security",
  "Kubernetes security", "supply chain security", "OT security", "IoT security",
  "mobile security", "email security", "browser security",

  // Compliance & frameworks
  "NIST", "ISO 27001", "SOC 2", "HIPAA", "PCI DSS", "GDPR", "FedRAMP",
  "MITRE ATT&CK", "CIS", "OWASP", "CMMC",

  // Technologies
  "Python", "Go", "Golang", "Rust", "JavaScript", "TypeScript", "Java", "C++",
  "React", "Node.js", "Docker", "Kubernetes", "Terraform", "AWS", "Azure", "GCP",
  "Linux", "Windows", "macOS",
  "Splunk", "Elastic", "Sentinel", "Chronicle", "Sumo Logic",
  "CrowdStrike Falcon", "SentinelOne", "Palo Alto Cortex", "Carbon Black",

  // AI/ML in security
  "AI", "machine learning", "deep learning", "LLM", "GenAI", "NLP",
  "anomaly detection", "behavioral analytics",

  // Roles
  "CISO", "security engineer", "security analyst", "security architect",
  "SOC analyst", "threat researcher", "malware analyst", "forensics",
  "GRC", "compliance analyst", "security consultant",
];

const keywordsLower = CYBER_KEYWORDS.map((k) => k.toLowerCase());

export function extractSkills(text: string): string[] {
  if (!text) return [];
  const textLower = text.toLowerCase();
  const found = new Set<string>();

  for (let i = 0; i < CYBER_KEYWORDS.length; i++) {
    if (textLower.includes(keywordsLower[i])) {
      found.add(CYBER_KEYWORDS[i]);
    }
  }

  return Array.from(found);
}
