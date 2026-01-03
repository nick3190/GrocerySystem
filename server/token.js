import jsonwebtoken from "jsonwebtoken";

const jwt = jsonwebtoken;

const secretKey = process.evn.JWT_SECRET || "123";

function generateToken(payload){
  return jwt.sign(payload, secretKey , {expiresIn: '1h'});
  {id: userInfo.id, username; userInfo.username}

}

export { generateToken };

