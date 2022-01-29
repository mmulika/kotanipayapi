const functions = require('firebase-functions');
const admin = require('firebase-admin');
const firestore = admin.firestore();
const { getUserId, getUserDetails, getTargetCountry, getLocalCurrencyAmount, getTargetEscrow, number_format, checkIfSenderExists, processApiWithdraw, setProcessedTransaction, checkisUserKyced, addUserKycToDB, getExchangeRate  } = require("./modules/libraries");
// Express and CORS middleware init
const express = require('express');
 const cors = require('cors');

 const bearerToken = require('express-bearer-token');
const bcrypt = require('bcryptjs');
 const api_v2 = express().use(cors({ origin: true }), bearerToken());
const lib = require('./modules/libraries');
const {generateAccessToken, authenticateToken} = require('./modules');
const moment = require('moment');
var { getTxidUrl, getPinFromUser, createcypher, sendMessage, isValidPhoneNumber, validateMSISDN } = require('./modules/utilities');

//GLOBAL ENV VARIABLES
const iv = functions.config().env.crypto_iv.key;
const escrowMSISDN = functions.config().env.escrow.msisdn;
const signerMSISDN =  functions.config().env.ubiManager.msisdn;

const {  weiToDecimal, sendcUSD, checkIfBeneficiary, addBeneficiary, checkUbiScBalance, sendUBIClaim, buyCelo, getContractKit,  getLatestBlock, validateWithdrawHash } = require('./modules/celokit');

const kit = getContractKit();
const jenga = require('./modules/jengakit');
const { invalid } = require('moment');


// GLOBAL VARIABLES
const USD_TO_KES = '3128952f1782f60c1cf95c5c3d13b4dc739f1a0d';  
const KES_TO_USD = '883736ecb6bd36d6411c77bdf1351052a1f23c00';  
const GHS_TO_USD = '01fc5317bd43b9698600f2c411c17e92270d3771';
const USD_TO_GHS = 'd4379db945500fec8b6aa2a0b1027abbf625141a';


// KOTANI RESTFUL API
api_v2.post("/", async (req, res) => {
  if (req.method !== "POST"){ return res.status(500).json({ message: 'Not Allowed' }) }

  console.log(JSON.stringify(req.body));
  res.status(200).send('OK'); 
});

// 👍🏽 
api_v2.post('/api/login', async (req, res) => {
  let userMSISDN = await validateMSISDN(req.body.phoneNumber, req.body.countryCode)
  console.log('MSISDN:', userMSISDN);
  let userId = await lib.getUserId(userMSISDN);

  let userInfo = await lib.getKotaniPartnerDetails(userId);
  if (userInfo.data() === undefined || userInfo.data() === null || userInfo.data() === '') {
    return res.status(400).send('Cannot find user')
  }
  try {
    if(await bcrypt.compare(req.body.password, userInfo.data().password)) {
      const accessToken = generateAccessToken(userInfo.data());
      res.json({ status:201, accessToken: accessToken });
    } 
    else {return res.json({status:400, desc: 'Not Allowed'})}
  } catch (e){console.log(e); res.status(500).send() }
});

// 👍🏽 
//parameter: {"phoneNumber" : "E.164 number" } 
api_v2.post('/user/account/getBalance', authenticateToken, async (req, res) => {
  console.log("Received request for: " + req.url);
  try {
    let localCurrency = req.user.localCurrency;
    let permissionLevel = req.user.permissionLevel;
    if(permissionLevel != "partner" && permissionLevel != "admin" ){ return res.json({ status: 400, desc: `Unauthorized request` }) }
    let targetCountry = getTargetCountry(permissionLevel, req.user.targetCountry)    // req.user.targetCountry;       

    let userMSISDN = await validateMSISDN(`${req.body.phoneNumber}`, targetCountry); 
    let _isValidPhoneNumber = await isValidPhoneNumber(userMSISDN, targetCountry);
    if(!_isValidPhoneNumber){ return res.json({ status: 400, user: `${req.user.name}`, phoneNumber: `${userMSISDN}`, desc: `Invalid phoneNumber` })}
    
    let userId  = await getUserId(userMSISDN);
    let userstatusresult = await checkIfSenderExists(userId);
    console.log("User Exists? ",userstatusresult);
    if(!userstatusresult){ return res.json({status: 400, desc: `user does not exist`}) }
    let userInfo = await getUserDetails(userId);
    console.log('User Address => ', userInfo.data().publicAddress);
    
    const cusdtoken = await kit.contracts.getStableToken()
    let cusdBalance = await cusdtoken.balanceOf(userInfo.data().publicAddress) // In cUSD
    console.log(`CUSD Balance Before: ${cusdBalance}`)
    console.info(`Account balance of ${await weiToDecimal(cusdBalance)} CUSD`)
    let localCurrencyAmount = await getLocalCurrencyAmount(cusdBalance, `usd_to_${localCurrency}`);
    res.json({  
      status: 201,     
      address: `${userInfo.data().publicAddress}`, 
      balance: {
        currency: localCurrency.toUpperCase(),
        amount: number_format(localCurrencyAmount, 4)
      }   
    });
  } 
  catch (e) { console.log(e); res.json({ status: 400, desc: `invalid request` }) }
});

// 👍🏽 
api_v2.post('/user/account/details', authenticateToken, async (req, res) => {
  console.log("Received request for: " + req.url);
  try {
    let permissionLevel = req.user.permissionLevel;
    let targetCountry  =  getTargetCountry(permissionLevel, req.user.targetCountry)
    if(permissionLevel != "partner" && permissionLevel != "admin" && permissionLevel != "support"){ return res.json({ status: 400, desc: `Unauthorized request` }) }

    let userMSISDN = await validateMSISDN(`${req.body.phoneNumber}`, targetCountry); 
    let _isValidPhoneNumber = await isValidPhoneNumber(userMSISDN, targetCountry);
    console.log(`isValid ${targetCountry} PhoneNumber `, _isValidPhoneNumber)

    if(!_isValidPhoneNumber){ return res.json({ "status" : 400, "phoneNumber": `${userMSISDN}`, "message": `Invalid ${targetCountry} phoneNumber` })}
    
    let userId  = await getUserId(userMSISDN)
    console.log('UserId: ', userId)

    let userstatusresult = await checkIfSenderExists(userId);
    console.log("User Exists? ",userstatusresult);
    if(!userstatusresult){ return res.json({status: 400, desc: `user does not exist`}) }
    
    let userInfo = await getUserDetails(userId);
    res.json({status: 201, address : `${userInfo.data().publicAddress}`});
    
  } 
  catch (e) { console.log(e); res.json({ "status" : 400, "desc" : `invalid request` }) }
});

api_v2.post("/api/webhook/withdrawResponse", authenticateToken, async (req, res) => {
  try{
    if (req.method !== "POST"){ return res.status(500).json({ message: 'Not Allowed' }) }
    console.log('BezoTouch Callback messages');
    console.log(JSON.stringify(req.body));
    res.status(200).send(); 
  }catch(e){ console.log(e); res.status(400).send() }  
});

// 👍🏽 
api_v2.post("/transactions/getEscrow", authenticateToken, async (req, res) => { 
  console.log("Received request for: " + req.url);
  try{  
    let permissionLevel = req.user.permissionLevel;
    let targetCountry = getTargetCountry(permissionLevel, req.user.targetCountry);
    const escrows = functions.config().env.escrow;
    let escrowMSISDN = getTargetEscrow(targetCountry, escrows);
    if (escrowMSISDN == null ){return res.json({status: 400, desc: `country not supported`})}
    
    let escrowId  = await getUserId(escrowMSISDN);
    let escrowInfo = await getUserDetails(escrowId);
    console.log('Escrow Address => ', escrowInfo.data().publicAddress, 'country: ', targetCountry);

    let localCurrency = req.user.localCurrency;
    let pairId = await getUserId(`usd_to_${localCurrency}`);
    let usdMarketRate = await getExchangeRate(pairId);
    console.log('usdMarketRate: ', usdMarketRate)
    let cusd2localCurrencyRate = usdMarketRate - (0.02*usdMarketRate);
    res.json({
      "escrowAddress": escrowInfo.data().publicAddress,
      "conversionRate" : { "localCurrency": localCurrency.toUpperCase(), "cusdToLocalCurrencyRate" : `${cusd2localCurrencyRate}` }
    });
  }catch(e){console.log(e); res.json({status: 400, desc: 'invalid request', error: e})}
});

// 👍🏽
//parameters: {"phoneNumber" : "E.164 number" , "amount" : "value", "txhash" : "value"}
api_v2.post("/transactions/withdraw/sendToMpesa", authenticateToken, async (req, res) => {
  console.log("Received request for: " + req.url);  
  try{
    let phoneNumber = req.body.phoneNumber;
    let txhash = req.body.txhash;

    let permissionLevel = req.user.permissionLevel;
    let targetCountry = getTargetCountry(permissionLevel, req.user.targetCountry);
    let userMSISDN = await validateMSISDN(phoneNumber, targetCountry);

    let _isValidPhoneNumber = await isValidPhoneNumber(userMSISDN, "KE");
    if(!_isValidPhoneNumber){ return res.json({"status" : 400, "desc": `${userMSISDN} is not a valid KE phoneNumber`}) }    
    let userId  = await getUserId(userMSISDN);

    if(txhash == null || txhash ==''){ return res.json({ "status": 400, "desc": `Invalid Hash`, "comment" : `Transaction hash cannot be empty`}) }
    let txreceipt = await lib.validateCeloTransaction(txhash);
    if(txreceipt == null){ return res.json({ "status": 400, "desc": `Invalid Transaction Receipt`, "comment": `Only transactions to the Escrow address can be processed` }) }


    let escrowId  = await getUserId(escrowMSISDN);
    let escrowInfo = await getUserDetails(escrowId);
    let escrowAddress = escrowInfo.data().publicAddress;
    let txdetails = await validateWithdrawHash(txhash, escrowAddress);
    if(txdetails.status != "ok"){ return res.json({ "status": 400, "desc" : `Invalid Hash`, "comment" : `${txdetails.status}`}) }
    let validblocks = txdetails.txblock;
    let _validblocks = parseInt(validblocks);
    _validblocks = _validblocks + 1440;
    let latestblock = await getLatestBlock();
    let _latestblock = parseInt(latestblock.number);
    if(txreceipt.status != true || _validblocks < _latestblock ){ return res.json({"status": 400, "desc": `Invalid Transaction`, "blockNumber" : txdetails.txblock, "latestBlock" : _latestblock })}

    console.log('Processing MPESA withdraw Transaction')
    
    let userExists = await lib.checkIfSenderExists(userId);
    if(userExists === false){         
      let userCreated = await lib.createNewUser(userId, userMSISDN);     
      console.log('Created user with userID: ', userCreated); 
    }
    let isverified = await lib.checkIfUserisVerified(userId);   
    console.log('isverified: ', isverified);
    if(!isverified){ return res.json({ "status": 400, "desc": "user account is not verified" })}
    
    let isProcessed = await lib.getProcessedTransaction(txhash);
    console.log('isProcessed: ', isProcessed) 
    if(isProcessed){ return res.json({ "status": 400, "desc": `Transaction Hash is already processed` }) }

    let withdrawDetails = {
      "blockNumber" : txdetails.txblock,
      "value" : `${txdetails.value} CUSD`,
      "from" : txdetails.from,
      "to" : txdetails.to,
      "date" : moment().format('YYYY-MM-DD, HH:mm:ss')
    }
    let _cusdAmount = number_format(txdetails.value, 4);
    let usdMarketRate = await getExchangeRate(USD_TO_KES);
    let cusdWithdrawRate = usdMarketRate*0.98;
    let kesAmountToReceive =  _cusdAmount*cusdWithdrawRate;
    kesAmountToReceive = number_format(kesAmountToReceive, 0)
    console.log(`Withdraw Amount KES: ${kesAmountToReceive}`);
    let jengabalance = await jenga.getBalance();
    console.log(`Jenga Balance: KES ${jengabalance.balances[0].amount}`);                

    if(kesAmountToReceive > jengabalance.balances[0].amount){ return res.json({ "status": 400, "desc": `Not enough fiat balance to fulfill the request`, "comment" : `Contact support to reverse your tx: ${txhash}` })}
    // Add auto-reverse on the smartcontract (TimeLock)
    console.log(txhash, ' Transaction hash is valid...processing payout')
    let jengaResponse = await processApiWithdraw(userMSISDN, kesAmountToReceive, txhash);
    console.log(jengaResponse);
    await setProcessedTransaction(txhash, withdrawDetails)
    console.log(txhash, ' Transaction processing successful')
    res.json({
      "status" : 201,
      "desc" : "Withdraw Transaction processing successful",
      "cusdDetails" : withdrawDetails,
      "MpesaDetails" : jengaResponse
    });
  } catch (e) { console.log(e); res.json({ "status" : 400, "desc" : `Invalid request` }) }
});

// 👍🏽
api_v2.post("/kyc/user/update", authenticateToken, async (req, res) => {
  try{
    console.log("Received request for: " + req.url);
    const phoneNumber = req.body.phoneNumber;

    let userNumber = req.user.phoneNumber;
    console.log('UserNumber: ', userNumber);
    let permissionLevel = req.user.permissionLevel;

    if(userNumber != "+254720670789" || permissionLevel != "partner") {return res.status(401).send({status: 'Unauthorized'})}
    let targetCountry = getTargetCountry(permissionLevel, req.user.targetCountry);

    let kycReqData = req.body;
    console.log(`KYC DATA: ${JSON.stringify(kycReqData)}`);
    let userMSISDN = ''; 

    let _isValidKePhoneNumber = await isValidPhoneNumber(phoneNumber, targetCountry);
    console.log('isValidKePhoneNumber ', _isValidKePhoneNumber)

    if(!_isValidKePhoneNumber){return res.json({ "status": 400, "Details": `Invalid PhoneNumber`})}

    if(_isValidKePhoneNumber){
      userMSISDN = await validateMSISDN(phoneNumber, targetCountry);
      let userId  = await getUserId(userMSISDN)
      let userstatusresult = await checkIfSenderExists(userId);
      if(!userstatusresult){ console.log('User does not exist: '); return res.json({ "status": 400, "desc": `User does not exist` }) } 

      let isKyced = await checkisUserKyced(userId);
      if(isKyced) { return res.json({ "status": 400, "desc": `KYC Document already exists` })}

      let newUserPin = await getPinFromUser();
      console.log('newUserPin', newUserPin)
      let enc_loginpin = await createcypher(newUserPin, userMSISDN, iv);
      let userdata = { displayName: `${kycReqData.fullname}`, disabled: false } 
      await admin.auth().updateUser(userId, userdata);
      await admin.auth().setCustomUserClaims(userId, {verifieduser: true, impactmarket: true });
      console.log(`User has been verified`)   
      await firestore.collection('hashfiles').doc(userId).set({'enc_pin' : `${enc_loginpin}`}); 
      await addUserKycToDB(userId, kycReqData);

      let message2sender = `Welcome to Kotanipay.\nYour account details have been verified.\nDial *483*354# to access the KotaniPay Ecosystem.\nUser PIN: ${newUserPin}`;
      sendMessage("+"+userMSISDN, message2sender);

      res.json({ "status": 201, "Details": `KYC completed successfully` });    
    }   
  }catch(e){ console.log(e); res.json({ "status": 400, "desc": `Invalid information provided` }) }
});

// 👍🏽
api_v2.post("/kyc/user/activate", authenticateToken, async (req, res) => {
  try{  
    if(permissionLevel != "admin" || permissionLevel != "partner") {return res.status(401).send({status: 'Unauthorized'})}
    
    let permissionLevel = req.user.permissionLevel;
    let targetCountry = getTargetCountry(permissionLevel, req.user.targetCountry);

    console.log("Received request for: " + req.url);
    const phoneNumber = req.body.phoneNumber;
    let _isValidPhoneNumber = await isValidPhoneNumber(phoneNumber, targetCountry);
    console.log('isValidPhoneNumber ', _isValidPhoneNumber)

    if(!_isValidPhoneNumber){return res.json({ "status": 400, "desc": `Invalid PhoneNumber`})}

    let userMSISDN = await validateMSISDN(phoneNumber, targetCountry);
    let userId  = await getUserId(userMSISDN)
    console.log('UserId: ', userId)

    let userstatusresult = await checkIfSenderExists(userId);
    if(!userstatusresult){ console.log('User does not exist: '); return res.json({ "status": 400, "desc": `User does not exist`}) } 

    await admin.auth().setCustomUserClaims(userId, {verifieduser: true, impactmarket: true})
    console.log(`User has been verified`)
    res.json({ "status": 201, "desc": `User has been verified` });     
  }catch(e){ console.log(e); res.json({ "status": 400, "desc": `Invalid PhoneNumber Supplied` }) }
});

// 👍🏽
api_v2.post("/kyc/user/create", authenticateToken, async (req, res) => {
  console.log("Received request for: " + req.url);
  try{
    const phoneNumber = req.body.phoneNumber;
    console.log(JSON.stringify(req.body));
    
    let permissionLevel = req.user.permissionLevel;
    let targetCountry = getTargetCountry(permissionLevel, req.user.targetCountry);

    let _isValidPhoneNumber = await isValidPhoneNumber(phoneNumber, targetCountry);
    console.log('isValidKePhoneNumber ', _isValidPhoneNumber)
    if(!_isValidPhoneNumber){return res.json({status: 400, desc: 'invalid phoneNumber'})}

    let userMSISDN = await validateMSISDN(phoneNumber, targetCountry);

    let userId = await lib.getUserId(userMSISDN);
    console.log('senderId: ', userId); 
    let userExists = await lib.checkIfSenderExists(userId);
    console.log("Sender Exists? ",userExists);
    if(userExists){ return res.json({status: 400, desc: 'user exists', userId: userId}) }

    if(!userExists){       
      await lib.createNewUser(userId, userMSISDN);     
      console.log('Created user with userID: ', userId); 
      res.json({status: 201, userId: userId});
    }
  }catch(e){ res.json({ "status": 400, "desc": `Invalid PhoneNumber Supplied` }) }
});

// 👍🏽
api_v2.post('/kyc/user/isverifiedcheck', authenticateToken, async (req, res) => {
  console.log("Received request for: " + req.url);
  try {
    const phoneNumber = req.body.phoneNumber;
    let permissionLevel = req.user.permissionLevel;
    let targetCountry = getTargetCountry(permissionLevel, req.user.targetCountry);

    let userMSISDN = await validateMSISDN(phoneNumber, targetCountry);

    let _isValidPhoneNumber = await isValidPhoneNumber(userMSISDN, targetCountry);
    if(!_isValidPhoneNumber){return res.json({status: 400, desc: 'invalid phoneNumber'})}

    let userId  = await lib.getUserId(userMSISDN)
    console.log('UserId: ', userId)

    let userExists = await lib.checkIfSenderExists(userId);
    console.log("User Exists? ",userExists);
    if(!userExists){ return res.json({status: 400, desc: 'user does not exist'}) }
    
    let isverified = await lib.checkIfUserisVerified(userId);   
    console.log('isverified: ', isverified);    
    
    res.json({status: isverified})
  } catch (e) { res.json({ status : 400}) }
});

// 👍🏽
// Parameters: phoneNumber
api_v2.post("/kyc/user/getDetailsByPhone", authenticateToken, async (req, res) => {
  try{
    let phoneNumber = req.body.phoneNumber;
    let permissionLevel = req.user.permissionLevel;
    let targetCountry = getTargetCountry(permissionLevel, req.user.targetCountry);

    let _isValidPhoneNumber = await isValidPhoneNumber(userMSISDN, targetCountry);
    console.log('isValidKePhoneNumber ', _isValidPhoneNumber)
    if(!_isValidPhoneNumber){return res.json({ "status": 400, "desc": `Invalid PhoneNumber`})}

    let userMSISDN = await validateMSISDN(phoneNumber, targetCountry);
    let userRecord = await admin.auth().getUserByPhoneNumber(`+${userMSISDN}`)
    console.log(`Successfully fetched user data: `, JSON.stringify(userRecord.toJSON()));
    res.json(userRecord.toJSON());
  }catch(e){
    console.log('PhoneNumber not found', JSON.stringify(e));
    res.json({"status" : 400});
  }
});

// 👍🏽
api_v2.post("/kyc/user/setDetails", authenticateToken, async (req, res) => {
  try{
    console.log("Received request for: " + req.url);
    const phoneNumber = req.body.phoneNumber;
    let permissionLevel = req.user.permissionLevel;

    if(permissionLevel != "partner" && permissionLevel != "support") {return res.status(401).send({status: 'Unauthorized'})}
    let targetCountry = getTargetCountry(permissionLevel, req.user.targetCountry);

    let kycReqData = req.body;
    console.log(`KYC DATA: ${JSON.stringify(kycReqData)}`);

    let _isValidPhoneNumber = await isValidPhoneNumber(phoneNumber, targetCountry);
    console.log('isValidPhoneNumber ', _isValidPhoneNumber)

    if(!_isValidPhoneNumber){return res.json({ "status": 400, "Details": `Invalid PhoneNumber`})}

    if(_isValidPhoneNumber){
      let userMSISDN = await validateMSISDN(phoneNumber, targetCountry);

      let userId  = await getUserId(userMSISDN)
      console.log('UserId: ', userId)
      let userstatusresult = await checkIfSenderExists(userId);
      if(!userstatusresult){ console.log('User does not exist: '); return res.json({ "status": 400, "desc": `User does not exist` }) } 

      let isKyced = await checkisUserKyced(userId);
      if(isKyced) { return res.json({ "status": 400, "desc": `KYC Document already exists` })}
      let newUserPin = await getPinFromUser();
      console.log('newUserPin', newUserPin)
      let enc_loginpin = await createcypher(newUserPin, userMSISDN, iv);
      let userdata = { displayName: `${kycReqData.fullname}`, disabled: false };
      let program = kycReqData.programName;
      await admin.auth().updateUser(userId, userdata);
      await admin.auth().setCustomUserClaims(userId, {verifieduser: true, country: targetCountry, [program]: true});
      console.log(`User has been verified`)
      await firestore.collection('hashfiles').doc(userId).set({'enc_pin' : `${enc_loginpin}`}); 
      await addUserKycToDB(userId, kycReqData);
      res.json({ "status": 201, "desc": `KYC completed successfully` });    
    }   
  }catch(e){ console.log(JSON.stringify(e)); res.json({ "status": 400, "desc": `invalid information provided` }) }
});

api_v2.post("/programs/kyc/updateUser", authenticateToken, async (req, res) => {
  try{
    console.log("Received request for: " + req.url);
    const phoneNumber = req.body.phoneNumber;

    let permissionLevel = req.user.permissionLevel;
    if(permissionLevel != "partner" && permissionLevel != "support") {return res.status(401).send({status: 'Unauthorized'})}
    let targetCountry = getTargetCountry(permissionLevel, req.user.targetCountry);

    let kycReqData = req.body;
    console.log(`KYC DATA: ${JSON.stringify(kycReqData)}`);
    let _isValidPhoneNumber = await isValidPhoneNumber(phoneNumber, targetCountry);
    console.log('isValidPhoneNumber ', _isValidPhoneNumber)

    if(_isValidPhoneNumber){
      let userMSISDN = await validateMSISDN(phoneNumber, targetCountry);
      let userId  = await getUserId(userMSISDN);
      let userstatusresult = await checkIfSenderExists(userId);
      if(!userstatusresult){ return res.json({ "status": 400, "desc": `User does not exist` })} 

      let isKyced = await checkisUserKyced(userId);
      // If Already KYC'd
      if(isKyced) { return res.json({ "status": `active`, "Comment": `KYC Document already exists` })}

      let newUserPin = await getPinFromUser();
      console.log('newUserPin', newUserPin)
      let enc_loginpin = await createcypher(newUserPin, userMSISDN, iv);
      let userdata = { displayName: `${kycReqData.fullname}`, disabled: false } ;
      let program = kycReqData.programName;
      console.log(`programName: ${program}`);
      if(program == invalid || program == null){return res.json({ "status": 400, "desc": `invalid programId` })}
      await admin.auth().updateUser(userId, userdata);
      await admin.auth().setCustomUserClaims(userId, {verifieduser: true, [program]: true });
      console.log(`User has been verified`)
      await firestore.collection('hashfiles').doc(userId).set({'enc_pin' : `${enc_loginpin}`}); 
      await addUserKycToDB(userId, kycReqData);    
      res.json({ "status": 201, "desc": `KYC completed successfully` });    
    }
   
  }catch(e){ console.log(JSON.stringify(e)); res.json({ "status": 400, "desc": `invalid information provided` }) }
});

// 👍🏽
api_v2.post("/user/resetPin", authenticateToken, async (req, res) => {
  try{
    console.log("Received request for: " + req.url);
    const phoneNumber = req.body.phoneNumber;
    const newUserPin = req.body.newUserPin;
    let permissionLevel = req.user.permissionLevel;
    let userNumber = req.user.phoneNumber;
    console.log('UserNumber: ', userNumber, 'permission: ', permissionLevel);

    if(permissionLevel != "support" && permissionLevel != "admin") {return res.status(401).send({status: 'Unauthorized'})}
    let targetCountry = getTargetCountry(permissionLevel, req.user.targetCountry);
    let _isValidPhoneNumber = await isValidPhoneNumber(phoneNumber, targetCountry);
    console.log('isValidPhoneNumber ', _isValidPhoneNumber)

    if(!_isValidPhoneNumber){return res.json({ "status": 400, "desc": `Invalid PhoneNumber`})}

    if(_isValidPhoneNumber){
      let userMSISDN = await validateMSISDN(phoneNumber, targetCountry);

      let userId  = await getUserId(userMSISDN)
      let userstatusresult = await checkIfSenderExists(userId);
      if(!userstatusresult){ console.log('User does not exist: '); return res.json({ "status": 400, "desc": `User does not exist` }) } 

      let isKyced = await checkisUserKyced(userId);
      if(!isKyced) { return res.json({ "status": 400, "desc": `User is not KYC'ed` })}
      if(newUserPin.length < 4 ) {return res.json({status: 400, desc: `PIN must be atleast 4 characters`})}
      console.log('newUserPin', newUserPin)
      let enc_loginpin = await createcypher(newUserPin, userMSISDN, iv);
      await firestore.collection('hashfiles').doc(userId).update({'enc_pin' : `${enc_loginpin}`});
      let message2sender = `Your Kotani Pay PIN has been updated.\nDial *483*354# to access the KotaniPay Ecosystem.\nNew User PIN: ${newUserPin}`;
      sendMessage("+"+userMSISDN, message2sender);

      res.json({ "status": 201, "desc": `${userMSISDN} Kotani Pay PIN updated successfully` });    
    }   
  }catch(e){ console.log(JSON.stringify(e)); res.json({ "status": 400, "desc": `invalid information provided` }) }
});

//parameters: {celloAddress, phoneNumber, amount} 
// 👍🏽
api_v2.post("/transactions/withdraw/getMpesaStatus", authenticateToken, async (req, res) => { 
  try{
    let permissionLevel = req.user.permissionLevel;
    let targetCountry = getTargetCountry(permissionLevel, req.user.targetCountry);
    if(targetCountry != "KE") {return res.json({ "status" : 400, "desc" : `Invalid request` })}

    let requestId = req.body.requestId;
    let requestDate = req.body.requestDate;
    let status = await jenga.getTransactionStatus(requestId, requestDate);
    let _mpesaref = status.mpesaref;

    if(_mpesaref.length > 2){ return res.json(status) }
    if(_mpesaref.length == 0){ return res.json({status: 400, desc: "Mpesa Transaction not found"}) }

  } catch (e) { res.json({ "status" : 400, "user" : `Invalid request` }) }
});

api_v2.post('/transactions/transfer/p2p', authenticateToken, async (req, res) => {  
  try{
    // console.log("Received request for: " + req.url);
    let sender = req.body.sender;
    let recipient = req.body.recipient;
    let amount = req.body.amount;

    const senderMSISDN = await validateMSISDN(sender, targetCountry);        
    let _isValidSender = await isValidPhoneNumber(senderMSISDN, targetCountry);

    const receiverMSISDN = await validateMSISDN(recipient, targetCountry);     
    let _isValidRecipient = await isValidPhoneNumber(receiverMSISDN, targetCountry);


    if(!_isValidSender || !_isValidRecipient){ return res.json({  "status" : 400, "desc": `Invalid phoneNumber` }) }

    if(_isValidSender && _isValidRecipient){
      const senderId = await getUserId(senderMSISDN);
      let isSenderVerified = await lib.checkIfUserisVerified(senderId);
      if(!isSenderVerified){ return res.json({ "status": 400, "desc": "not verified"  }) }

      // Send funds to the depositor CUSD account
      const recipientId = await getUserId(receiverMSISDN);
      let isRecipientVerified = await lib.checkIfUserisVerified(recipientId);   
      console.log('isverified: ', isRecipientVerified);
      if(!isRecipientVerified){ return res.json({ "status": 'unverified',  "message": "account is unverified" }) }

      let recipientstatusresult = await lib.checkIfRecipientExists(recipientId);
      if(!recipientstatusresult){ return res.json({ "status": 400, "desc": "user account does not exist" }) }

      let senderInfo = await lib.getUserDetails(senderId);
      while (senderInfo.data() === undefined || userInfo.data() === null || userInfo.data() === ''){
        await sleep(1000);
        senderInfo = await lib.getUserDetails(senderId);
        // console.log('Receiver:', receiverInfo.data());
      }
      console.log('User Address => ', senderInfo.data().publicAddress);
      console.log('senderId: ', senderId);
  
      await admin.auth().getUser(senderId)
      .then(user => {
        console.log('Depositor fullName: ',user.displayName); 
        // displayName = user.displayName;
        return;
      })
      .catch(e => {console.log(e)})
      
      // Retrieve User Blockchain Data
      let depositInfo = await lib.getUserDetails(senderId);
      let recipientInfo = await lib.getReceiverDetails(recipientId);
      let escrowprivkey = await getSenderPrivateKey(recipientInfo.data().seedKey, receiverMSISDN, iv);
      let cusdAmount = number_format(amount, 4);
      let ghs_to_usd = await getExchangeRate(GHS_TO_USD);
      if(depositCurrency === "GHS"){ cusdAmount = cusdAmount*ghs_to_usd }
      console.log(`CUSD deposit amount: ${cusdAmount}`); 
      let receipt = await sendcUSD(recipientInfo.data().publicAddress, depositInfo.data().publicAddress, `${cusdAmount}`, escrowprivkey);
      let url = await getTxidUrl(receipt.transactionHash);
      console.log('tx URL', url);

      return res.json({ 
        "status" : 201,      
        "phoneNumber": `${receiverMSISDN}`, 
        "amountTransferred" : { "currency" : `${targetCountry}S`, "amount" : `${amount}`},
        "txnHash" : `${receipt.transactionHash}`      
      });
    }
  }catch(e){ console.log('Error: ',e);  res.json({ "status" : 400, "desc": `your request is invalid` }) }
});

// @params: { "depositPhoneNumber" : "String", "depositAmount" : { "currency" : "String", "amount" : "String" } }
// 👍🏽
api_v2.post('/transactions/deposit/momo',  authenticateToken, async (req, res) => {
  try{
    let permissionLevel = req.user.permissionLevel;
    let targetCountry = getTargetCountry(permissionLevel, req.user.targetCountry);
    const escrowMSISDN = functions.config().env.escrow.bezomoney.msisdn;
    let depositorMSISDN = req.body.phoneNumber;
    const depositCurrency = req.body.currency;
    let amount = req.body.amount;
    let _depositorIsValidZMPhoneNumber = await isValidGhPhoneNumber(depositorMSISDN);
    console.log(depositorMSISDN, 'Depositor isValidGhPhoneNumber ', _depositorIsValidZMPhoneNumber)

    if(_depositorIsValidZMPhoneNumber){
      depositorMSISDN = phoneUtil.format(phoneUtil.parseAndKeepRawInput(`${depositorMSISDN}`, 'GH'), PNF.E164);
      depositorMSISDN = depositorMSISDN.substring(1);
      const depositorId = await getUserId(depositorMSISDN);

      let depositorstatusresult = await lib.checkIfRecipientExists(depositorId);
      if(!depositorstatusresult){ return res.json({ "status": 400, "desc": "user account does not exist" })} 

      let isverified = await lib.checkIfUserisVerified(depositorId);   
      console.log('isverified: ', isverified);
      if(!isverified){ return res.json({ "status": 400, "desc": "user account is not verified" })}

      // Send funds to the depositor CUSD account
      const escrowId = await getUserId(escrowMSISDN)
      let depositorInfo = await lib.getUserDetails(depositorId);
      while (depositorInfo.data() === undefined || depositorInfo.data() === null || depositorInfo.data() === ''){
        await sleep(1000);
        depositorInfo = await lib.getUserDetails(depositorId);
        // console.log('Receiver:', receiverInfo.data());
      }
      console.log('User Address => ', depositorInfo.data().publicAddress);
      console.log('depositorId: ', depositorId);
  
      await admin.auth().getUser(depositorId)
      .then(user => {
        console.log('Depositor fullName: ',user.displayName); 
        // displayName = user.displayName;
        return;
      })
      .catch(e => {console.log(e)})
      
      // Retrieve User Blockchain Data
      let depositInfo = await lib.getUserDetails(depositorId);
      let escrowInfo = await lib.getReceiverDetails(escrowId);
      let escrowprivkey = await lib.getSenderPrivateKey(escrowInfo.data().seedKey, escrowMSISDN, iv);
      let cusdAmount = number_format(amount, 4);
      let ghs_to_usd = await getExchangeRate(GHS_TO_USD);
      if(depositCurrency === "GHS"){ cusdAmount = cusdAmount*ghs_to_usd }

      console.log(`CUSD deposit amount: ${cusdAmount}`);    
      
  
      let receipt = await sendcUSD(escrowInfo.data().publicAddress, depositInfo.data().publicAddress, `${cusdAmount}`, escrowprivkey);
      let url = await getTxidUrl(receipt.transactionHash);

      res.json({ 
        "status" : 201,      
        "phoneNumber": `${escrowMSISDN}`, 
        "amountDeposited" : { "currency" : "GHS", "amount" : `${amount}`},
        "txnHash" : `${receipt.transactionHash}`,
        "depositReference": `fiatTxnReferenceId`      
      });


    }else{
      res.json({ "status" : 400, "phoneNumber": `${escrowMSISDN}`, "desc": `The number provided is not a valid phoneNumber`  });
    }
  }catch(e){ console.log('Error: ',e);  res.json({ "status" : 400, "desc": `your request is invalid` }) }
});

api_v2.post('/transactions/withdraw/momo', authenticateToken, async (req, res) => { 
  try{
    console.log("Received request for: " + req.url);
    const phoneNumber = req.body.phoneNumber;
    let amount = req.body.amount;
    let fiatTxnReferenceId = req.body.fiatTxnReferenceId;

    let permissionLevel = req.user.permissionLevel;
    if(permissionLevel != "partner") {return res.status(401).send({status: 'Unauthorized'})};

    let targetCountry = getTargetCountry(permissionLevel, req.user.targetCountry);
    let escrowMSISDN;
    if(targetCountry=="GH"){escrowMSISDN = functions.config().env.escrow.bezomoney.msisdn}else{escrowMSISDN = functions.config().env.escrow.equitel}

    let withdrawMSISDN = await validateMSISDN(phoneNumber, targetCountry);    
    let _isValidPhoneNumber = await isValidPhoneNumber(withdrawMSISDN, targetCountry);
    if(!_isValidPhoneNumber){ return res.json({ "status" : 400, "phoneNumber": `${withdrawMSISDN}`, "desc": `invalid phoneNumber`}) }
    const withdrawerId = await getUserId(withdrawMSISDN);

    let withdrawerstatusresult = await lib.checkIfRecipientExists(withdrawerId);
    if(!withdrawerstatusresult){ return res.json({ "status": 400, "desc": "user account does not exist" }) } 

    let isverified = await lib.checkIfUserisVerified(withdrawerId);
    if(!isverified){ return res.json({ "status": 400, "desc": "user account is not verified" }) }

    const escrowId = await getUserId(escrowMSISDN)
    let withdrawerInfo = await getUserDetails(withdrawerId);
    console.log('User Address => ', withdrawerInfo.data().publicAddress);
    console.log('withdrawerId: ', withdrawerId);

    let userData = await admin.auth().getUser(withdrawerId);
    console.log('Withdrawer fullName: ',user.displayName)
    
    
    // Retrieve User Blockchain Data
    let escrowInfo = await lib.getReceiverDetails(escrowId);
    let withdrawerprivkey = await lib.getSenderPrivateKey(withdrawerInfo.data().seedKey, withdrawMSISDN, iv);
    let cusdAmount = number_format(amount, 4);
    let ghs_to_usd = await getExchangeRate(GHS_TO_USD);
    cusdAmount = cusdAmount*ghs_to_usd
    cusdAmount = number_format(cusdAmount, 4);
    const cusdtoken = await kit.contracts.getStableToken()
    let cusdBalance = await cusdtoken.balanceOf(withdrawerInfo.data().publicAddress);
    if (cusdAmount > parseFloat(cusdBalance, 4)) {return res.json({status: 400, desc: 'insufficient balance'})}

    console.log(`CUSD withdraw amount: ${cusdAmount}`);

    let receipt = await sendcUSD(withdrawerInfo.data().publicAddress, escrowInfo.data().publicAddress, `${cusdAmount}`, withdrawerprivkey);
    let url = await getTxidUrl(receipt.transactionHash);
    console.log('tx URL', url);

    res.json({ 
      "status" : 201,      
      "phoneNumber": `${withdrawMSISDN}`, 
      "amountWithdrawn" : { "currency" : `${targetCountry}S`, "amount" : `${amount}`},
      "txnHash" : `${receipt.transactionHash}`,
      "withdrawReference": `${fiatTxnReferenceId}`      
    }); 
    
    console.log(parseInt(cusdAmount*ghs_to_usd));
    
  }catch(e){ console.log('Error: ',e); res.json({ "status" : 400, "desc": `Invalid request` })  }
});

// 👍🏽
api_v2.post( "/transactions/ubi/claimfunds", authenticateToken, async (req, res) => {
  try {
    let phoneNumber = req.body.phoneNumber;
    let PROGRAM_NAME = req.body.programId;
    let permissionLevel = req.user.permissionLevel;
    let targetCountry = getTargetCountry(permissionLevel, req.user.targetCountry);

    let senderMSISDN = await validateMSISDN(phoneNumber, targetCountry);
    let _isValidPhoneNumber = await isValidPhoneNumber(senderMSISDN, targetCountry);
    if(!_isValidPhoneNumber){return res.json({ status: 400, "desc" : `${senderMSISDN} is not a valid phoneNumber`})}
    
    let senderId = await getUserId(senderMSISDN);
    let isverified = await lib.checkIfUserisVerified(senderId); 
    if(!isverified){ return res.json({status: 400,  "desc": "user account is not verified" }) }

    let senderInfo = await getUserDetails(senderId);
    let senderAddress = senderInfo.data().publicAddress 

    let programId = await getUserId(PROGRAM_NAME);
    let UBISCADDRESS = ``;
    if(targetCountry == 'KE' && programId == 'f97de62a9424cc14113f997adeee0fdcdc9c7694'){UBISCADDRESS = `0x667973de162C7032e816041a1Eef42261901EbE3`}    //KAKUMA CAMP
    if(targetCountry == 'KE' && programId == '29b0e54c8f30b578b4fb4368eb3bf9f20a184098'){UBISCADDRESS = `0x27A9f905481D666A51148A4b43Ad4254cf105103`}    //KOWITI CAMP
    if(targetCountry == 'KE' && programId == '4d7ff8780825d44d9031c1d9082c7248459fc6c1'){UBISCADDRESS = `0xa4046EBD28E9c231284F26325F843a8eEd44687D`}    //ORAM CAMP
    if(targetCountry == 'GH' && programId == 'daad568c68bf176607dff3214e0187d97af5923f'){UBISCADDRESS = `0x667973de162C7032e816041a1Eef42261901EbE3`}    // KRISHAN CAMP
    if(targetCountry == 'GH' && programId == '28f994aaa868eb04ee51d93ba4ded9ffd753dfc6'){UBISCADDRESS = `0x23091cb65b79235aba66b9cecd49ca005ea7d4e7`}    // MTN-WELFARE CAMP

    let ubiapprovedstatus = await checkIfBeneficiary(senderAddress, UBISCADDRESS);
    console.log("Beneficiary Status: ",ubiapprovedstatus);  //checkIfBeneficiary
    if(ubiapprovedstatus != 1){ 
      console.log(`${senderMSISDN} Approval status is: ${ubiapprovedstatus}`);
      return res.json({status: 400, "desc": `You\'re not approved to access this service`});
    }  

    let ubiScBalance = await checkUbiScBalance(UBISCADDRESS);
    console.log("UBI SC Balance: ", ubiScBalance );  //checkUbiScBalance
    if(ubiScBalance < 2){ return res.json({  status: 400, "desc": `Insufficient funds in the UBI account. \nPlease try again later` }) }
    
    // Retrieve User Blockchain Data    
    let senderprivkey = await lib.getSenderPrivateKey(senderInfo.data().seedKey, senderMSISDN, iv)  

    let receipt = await sendUBIClaim(senderAddress, senderprivkey, UBISCADDRESS);
    console.log('Indexjs_UBI Claim response: ',JSON.stringify(receipt));

    if(receipt === 'failed' || receipt === 'invalid'){ return res.json({status: 400, desc: `Unable to process your UBI claim`}) }  
    
    if(receipt.status === 'NOT_YET'){
      const unixTimestamp = parseInt(receipt.claimTime);
      const claimTime = moment.unix(unixTimestamp).format('YYYY-MM-DD, HH:mm:ss');
      return res.json({status: 400, desc: `Unable to process your UBI claim, Its not yet time, Retry claim after: ${claimTime}`});
    }

    let url = await getTxidUrl(receipt.transactionHash);
    console.log('UBI Claim tx URL', url);
    res.json({status: 201, desc: `Your UBI Claim Request was successful.`, txid: url });
    
  } catch  (e) { console.log(e); res.json({ "status" : 400, "desc" : `Invalid request` }) }
});

api_v2.post( "/transactions/ubi/checkIfBeneficiary", authenticateToken, async (req, res) => {
  try {
    let phoneNumber = req.body.phoneNumber;
    let PROGRAM_NAME = req.body.programId;
    let permissionLevel = req.user.permissionLevel;
    let targetCountry = getTargetCountry(permissionLevel, req.user.targetCountry);
    // if(targetCountry != "KE") {return res.json({ "status" : 400, "desc" : `Invalid request` })}

    let senderMSISDN = await validateMSISDN(phoneNumber, targetCountry);
    let _isValidPhoneNumber = await isValidPhoneNumber(senderMSISDN, targetCountry);
    if(!_isValidPhoneNumber){return res.json({ status: 400, "desc" : `${senderMSISDN} is not a valid phoneNumber`})}
    
    let senderId = await getUserId(senderMSISDN);
    let isverified = await lib.checkIfUserisVerified(senderId); 
    if(!isverified){ return res.json({status: 400,  "desc": "user account is not verified" }) }

    let senderInfo = await getUserDetails(senderId);
    let senderAddress = senderInfo.data().publicAddress 
    // if(req.user.phoneNumber == "+233249993319"){programId == 'mtn-insurance'};

    let programId = await getUserId(PROGRAM_NAME);
    let UBISCADDRESS = ``;
    if(targetCountry == 'KE' && programId == 'f97de62a9424cc14113f997adeee0fdcdc9c7694'){UBISCADDRESS = `0x667973de162C7032e816041a1Eef42261901EbE3`}    //KAKUMA CAMP
    if(targetCountry == 'KE' && programId == '29b0e54c8f30b578b4fb4368eb3bf9f20a184098'){UBISCADDRESS = `0x27A9f905481D666A51148A4b43Ad4254cf105103`}    //KOWITI CAMP
    if(targetCountry == 'KE' && programId == '4d7ff8780825d44d9031c1d9082c7248459fc6c1'){UBISCADDRESS = `0xa4046EBD28E9c231284F26325F843a8eEd44687D`}    //ORAM CAMP
    if(targetCountry == 'GH' && programId == 'daad568c68bf176607dff3214e0187d97af5923f'){UBISCADDRESS = `0x667973de162C7032e816041a1Eef42261901EbE3`}    // KRISHAN CAMP
    if(targetCountry == 'GH' && programId == '28f994aaa868eb04ee51d93ba4ded9ffd753dfc6'){UBISCADDRESS = `0x23091cb65b79235aba66b9cecd49ca005ea7d4e7`}    // MTN-WELFARE CAMP


    let ubiapprovedstatus = await checkIfBeneficiary(senderAddress, UBISCADDRESS);
    console.log("Beneficiary Status: ",ubiapprovedstatus);  //checkIfBeneficiary
    if(ubiapprovedstatus != 1){ return res.json({status: 400, "desc": `Not a beneficiary`}) }
    if(ubiapprovedstatus == 1){ return res.json({status: 201, "desc": `User is a beneficiary`}) }
    
  } catch  (e) { console.log(e); res.json({ "status" : 400, "desc" : `Invalid request` }) }
});

api_v2.post( "/transactions/ubi/setBeneficiary", authenticateToken, async (req, res) => {
  try {    
    let phoneNumber = req.body.phoneNumber;
    let PROGRAM_NAME = req.body.programId;
    let targetCountry = getTargetCountry(req.user.permissionLevel, req.user.targetCountry);
    let senderMSISDN = await validateMSISDN(phoneNumber, targetCountry);
    let _isValidPhoneNumber = await isValidPhoneNumber(senderMSISDN, targetCountry);
    if(!_isValidPhoneNumber){return res.json({ status: 400, "desc" : `${senderMSISDN} is not a valid phoneNumber`})}
    
    let senderId = await getUserId(senderMSISDN);
    let isverified = await lib.checkIfUserisVerified(senderId); 
    if(!isverified){ return res.json({status: 400,  "desc": "user account is not verified" }) }

    let senderInfo = await getUserDetails(senderId);
    let senderAddress = senderInfo.data().publicAddress;
    let signerNumber = req.user.phoneNumber;
    let programId = await getUserId(PROGRAM_NAME);

    let UBISCADDRESS = ``;
    if(programId != 'f97de62a9424cc14113f997adeee0fdcdc9c7694' && programId != '29b0e54c8f30b578b4fb4368eb3bf9f20a184098' && programId != '4d7ff8780825d44d9031c1d9082c7248459fc6c1' && programId != 'daad568c68bf176607dff3214e0187d97af5923f' && programId != '28f994aaa868eb04ee51d93ba4ded9ffd753dfc6' ) {return res.json({status: 400, "desc": `invalid UBI`})}
    if(targetCountry == 'KE' && programId == 'f97de62a9424cc14113f997adeee0fdcdc9c7694'){UBISCADDRESS = `0x667973de162C7032e816041a1Eef42261901EbE3`}    //KAKUMA CAMP
    if(targetCountry == 'KE' && programId == '29b0e54c8f30b578b4fb4368eb3bf9f20a184098'){UBISCADDRESS = `0x27A9f905481D666A51148A4b43Ad4254cf105103`}    //KOWITI CAMP
    if(targetCountry == 'KE' && programId == '4d7ff8780825d44d9031c1d9082c7248459fc6c1'){UBISCADDRESS = `0xa4046EBD28E9c231284F26325F843a8eEd44687D`}    //ORAM CAMP
    if(targetCountry == 'GH' && programId == 'daad568c68bf176607dff3214e0187d97af5923f'){UBISCADDRESS = `0x667973de162C7032e816041a1Eef42261901EbE3`}    // KRISHAN CAMP
    if(targetCountry == 'GH' && programId == '28f994aaa868eb04ee51d93ba4ded9ffd753dfc6'){UBISCADDRESS = `0x23091cb65b79235aba66b9cecd49ca005ea7d4e7`}    // MTN-WELFARE CAMP ##NOT A SC

    let ubiapprovedstatus = await checkIfBeneficiary(senderAddress, UBISCADDRESS);
    if(ubiapprovedstatus == 1){ return res.json({status: 400, "desc": `User is already a beneficiary`}) }

    let signerInfo = getUserDetails(await getUserId(signerMSISDN));
    let signerAddress = signerInfo.data().publicAddress;
    let signerPrivKey = await lib.getSenderPrivateKey(signerAddress.data().seedKey, signerMSISDN, iv)
    let result = await addBeneficiary(signerAddress, senderAddress, signerPrivKey, UBISCADDRESS);
    console.log(result);
    return res.json({status: 201, "desc": `User added as a beneficiary`, result})

  } catch  (e) { console.log(e); res.json({ "status" : 400, "desc" : `Invalid request` }) }

});

// Celo Functions
// Parameters: phoneNumber, celoAmount
api_v2.post("/dex/buyCelo", authenticateToken, async (req, res) => {
  let phoneNumber = req.body.phoneNumber;
  let _cusdAmount = req.body.cusdAmount;
  let cusdAmount = kit.web3.utils.toWei(`${_cusdAmount}`);


  try {
    let permissionLevel = req.user.permissionLevel;
    let targetCountry = getTargetCountry(permissionLevel, req.user.targetCountry);
    userMSISDN = await validateMSISDN(phoneNumber, targetCountry);

    let _isValidKePhoneNumber = await isValidPhoneNumber(userMSISDN, targetCountry);
    console.log('isValidKePhoneNumber ', _isValidKePhoneNumber)

    if(_isValidKePhoneNumber){
      let userId  = await getUserId(userMSISDN)
      console.log('UserId: ', userId)

      let userstatusresult = await checkIfSenderExists(userId);
      console.log("User Exists? ",userstatusresult);
      if(userstatusresult === false){ res.json({"status" : "user not found"}); return; }   
      
      let userInfo = await getUserDetails(userId);

      console.log('User Address => ', userInfo.data().publicAddress);
      let userprivkey = await lib.getSenderPrivateKey(userInfo.data().seedKey, userMSISDN, iv);
      console.log(`CUSD Exchange amount: ${_celoAmount}`);    
      
  
      let receipt = await buyCelo(userInfo.data().publicAddress,`${cusdAmount}`, userprivkey);

      res.json({ "status" : 201, "details" : `${receipt}`});
    }else{
      let message = { 
        "status" : 400,      
        "phoneNumber": `${userMSISDN}`, 
        "message": `The number provided is not a valid KE phoneNumber`      
      };
      res.json(message);
    }
    
  } catch (e) {
    res.json({"status" : "phonenumber not found"});
  }
});

module.exports = functions.https.onRequest(api_v2);
