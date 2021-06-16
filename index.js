// Create express app
var express = require("express")
var app = express()
var db = require("./database.js");
var Client = require('node-rest-client').Client; 
var client = new Client();
const fs = require('fs');
var phone = JSON.parse(fs.readFileSync('config/phone.json'));
var settings = JSON.parse(fs.readFileSync('config/settings.json'));

var sms_queue = [];
var HTTP_PORT = settings.port; 
var canSendSMS = false;
var processingSMS = false;
var interval;

const serialportgsm = require('serialport-gsm');

var gsmModem = serialportgsm.Modem()
var options = {
    baudRate: 9600,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    flowControl: false,
    xon: false,
    rtscts: false,
    xoff: false,
    xany: false,
    autoDeleteOnReceive: false,
    enableConcatenation: true,
    incomingCallIndication: true,
    incomingSMSIndication: true
}


gsmModem.open(settings.modem_path, options, (data) => { console.log(data) });

gsmModem.on('open', function(res){
    console.log("Opening Modem");
    gsmModem.initializeModem(function(res){
    
    	console.log("Initialized ", res);    
    	gsmModem.executeCommand(`AT+CPMS="SM","SM","SM"`);
    	canSendSMS = true;
    	
	gsmModem.setModemMode(function(d){console.log(d)}, phone.mode);

	gsmModem.getNetworkSignal(function(s){console.log("Signal ", s)});

	if (settings.environment == "development"){
		gsmModem.sendSMS(phone.test_number, phone.test_message, false, function (response) {
			console.log(response);
		});
	}
	
    });    
});

gsmModem.on('onMemoryFull', function(){
	console.log("SIM Card Memory Full");				
})

gsmModem.on('error', function(err){
    console.log(err);
});

app.listen(HTTP_PORT, () => {
    console.log("Server running on port %PORT%".replace("%PORT%",HTTP_PORT))
});

app.get("/", (req, res, next) => {
    res.json({"message":"Ok"})
});

function processMessage(message, sender){
	
	if (settings.mode == "FC"){
	//Check if ACK
	 if (message.startsWith("ACK")){
	 	acknowledge(message);	
	 }else{
	 	console.log("Unknown Message Type");
	 }
	}else if (settings.mode == "HQ"){
		if (message.startsWith("C^") || message.startsWith("M^") || message.startsWith("F^") || message.startsWith("I^")){
			saveSQLiteRecord(message, sender);
		}else{
			console.log("Unknown Message Type")
		}
	}
}

function saveSQLiteRecord(msg, sender){

	var person_id = msg.split("|")[0].split("^")[1];
	var sql = "INSERT INTO sms_message(person_id, message) VALUES (?, ?)";
	db.run(sql, [person_id, msg], function (err, result) {
		if (err){
		    console.log(err.message);
		}else{
			sendAck(msg, sender);
		}		    
	    }					
	);
}

function checkSQLiteMessages(){
	var sql = "SELECT person_id, count(*) AS total FROM sms_message WHERE processed = 0 GROUP BY person_id HAVING total >= 4 ";
	db.all(sql, [], function (err, rows) {
		if (err){
		    console.log(err.message);
		    return;
		}		

		if(rows.length > 0){
			console.log("Saving " + rows.length + " Birth Reports to Remote EBRS");
			saveRecordRemote(rows);
		}			
            }				
      )
}

function sendAck(m, sender){
	var person_id = m.split("|")[0].split("^")[1];
	var msg_type = m.split("")[0]
	var ack_msg = "ACK|" + person_id + "|" + msg_type;
	
	gsmModem.sendSMS(sender, ack_msg, false, function (response) {
		console.log('Message Status: ', response);
	});  
}

function saveRecordRemote(rows){

	var person = rows[0];
	var person_id = person.person_id;
	console.log("PersonID: ", person_id);
	
	var sql = "SELECT * from sms_message WHERE person_id = ? AND processed = 0";
	db.all(sql, [person_id], function (err, rows) {
		if (err){
		    console.log(err.message);
		    return;
		}
		
		var url = settings.local_ebrs_url + "/save_from_sms";
		var args = {
		    data: { sms_messages: rows },
		    headers: { "Content-Type": "application/json" }
		};

		client.post(url, args, function (data, response) {
	    
	    	    if (data == "OK"){
	    	        sql = "UPDATE sms_message SET processed = 1 WHERE person_id = ?";
			db.run(sql, [person_id], function (err, result) {
				if (err){
			           
				    console.log(err.message, person_id);
				}else{			
				     console.log("SUCCESS: " + person_id);
				}
			});	
	    	    }else{
	    	    	console.log("Failed to save remote record");
	    	    }	    	     	    
	    	    
		});		

					
            }				
      )
	
}

function acknowledge(msg){
	var msg_parts = msg.split("|");
	var person_id = msg_parts[1];
	
	var sql = "select * from sms_sync_tracker where person_id = ?"
    	var params = [person_id];
    
	db.get(sql, params, (err, row) => {
		if (err) {
		  res.status(400).json({"error": err.message});
		  return;
		}        
	
	
		ack = row.acknowledged;
		if (ack == null){
			ack = "";
		}
		
		ack = ack + msg_parts[2];
		ack = ack.toLowerCase().split("").sort();
		ack = ack.filter(function(elem, pos) {
		    return ack.indexOf(elem) == pos;
		});
		
		ack = ack.join("").toLowerCase();
		
		datetime = null;
		if (ack == "cfim"){
			datetime = new Date().toISOString().slice(0, 19).replace('T', ' ');
		}
		
		sql = "UPDATE sms_sync_tracker SET acknowledged = ?, date_acknowledged = ? WHERE person_id = ?";
		db.run(sql, [ack, datetime, person_id], function (err, result) {
			if (err){
			    throw err.message;
			    return;
			}else{			
			     console.log(("ACK " + person_id), ack);
			}
	            }					
		)		

      });    
}

function checkInbox(){

	gsmModem.getSimInbox(function(inbox){

		inbox_messages = inbox.data
		if (inbox_messages.length > 0){
			console.log(inbox.data.length + " Messages in Inbox");
			processingSMS = true;

			for (var i in inbox_messages){
				var inbox_message = inbox_messages[i].message;
				var sender = inbox_messages[i].sender;
				
				if (inbox_message.includes("|")){
					console.log("Processing Message: ", inbox_message);
					processMessage(inbox_message, sender);
				}
				
				gsmModem.deleteMessage(inbox_messages[i], function(res){console.log(res)});
			}

		}		
		
		checkSQLiteMessages();
		
		processingSMS = false;
		
		if (inbox.data.length > phone.max_sim_msgs){
			console.log("Deleting All SIM Messages")
			gsmModem.deleteAllSimMessages(function(res){console.log(res)});
		}
	});
}

function get_values(h){

	var ar = [];
	
	for (var k in h ){
		ar.push(h[k]);
	} 
	
	return ar;
}


function format(pid, d){

	var c_header = "C^"+pid+"^"+settings.site_code;
	var m_header = "M^"+pid+"^"+settings.site_code; 
	var f_header = "F^"+pid+"^"+settings.site_code;
	var i_header = "I^"+pid+"^"+settings.site_code;  
	
	var c = c_header + "|" + get_values(d['child_details']).join("|")
	var m = m_header + "|" + get_values(d['mother_details']).join("|")
	var f = f_header + "|" + get_values(d['father_details']).join("|")
	var i = i_header + "|" + get_values(d['informant_details']).join("|")
	
	
	sms_queue.push(c);
	sms_queue.push(m);
	sms_queue.push(f);
	sms_queue.push(i);
	
}

function sendMessages(sms_messages){

	if (canSendSMS){
		var sms = sms_messages.pop();
		sendSMS(sms);
		
		var person_id = sms.split("|")[0].split("^")[1];
		datetime = new Date().toISOString().slice(0, 19).replace('T', ' ');
		sql = "UPDATE sms_sync_tracker SET synced = true, date_synced = ? WHERE person_id = ?";
		db.run(sql, [datetime, person_id], function (err, result) {
			if (err){
			    res.status(400).json({"error": err.message})
			    return;
			}			        
	            }					
		)
				
		if (sms_messages.length > 0){
			sendMessages(sms_messages);		
		}		
	}	
}

function sendSMS(sms){
	
	gsmModem.sendSMS(phone.number, sms, false, function (response) {
		console.log('Message Status: ', response);
	});  
}

function formatMessage(queue){
	
	var sync_person_id = queue.pop().person_id;
	var url = settings.local_ebrs_url + "/get_birth_report?person_id=" + sync_person_id;
	
	client.get(url, function (data, response) {
	    
	    format(sync_person_id, data);
	    	    
	    if (queue.length > 0){
	    	formatMessage(queue);
	    }else{
	    	sms_queue = sms_queue.reverse();
	    	console.log(sms_queue);
	    	sendMessages(sms_queue);
	    }
	});
}

function formatMessages(){
	
	var sql = "SELECT person_id FROM sms_sync_tracker WHERE date_acknowledged IS NULL";
	sms_queue = [];
	db.all(sql, [], function (err, rows) {
			if (err){
			    console.log(err.message);
			    return;
			}
			
			console.log("Sending " + rows.length + " Birth Reports to NRB");
			if(rows.length > 0){
				formatMessage(rows);
			}			
	            }				
	      )	
};

app.get("/pending_births", (req, res, next) => {
    
    var person_id = req.query.person_id;
    var datetime  = req.query.datetime
    
    console.log(req.query.person_id, datetime);
    
    var sql = "select * from sms_sync_tracker where person_id = ?"
    var params = [person_id];
    
    db.get(sql, params, (err, row) => {
        if (err) {
          res.status(400).json({"error": err.message});
          return;
        }
        
	if (row == undefined){
		console.log("Tracker not available, Inserting one");
		sql = "INSERT INTO sms_sync_tracker(person_id, date_received) VALUES (?, ?)";
		db.run(sql, [person_id, datetime], function (err, result) {
			if (err){
			    res.status(400).json({"error": err.message})
			    return;
			}
			
			formatMessages();        
	            }					
		);
	}else{
		console.log("Tracker already exists, Updating");
		sql = "UPDATE sms_sync_tracker SET date_received = ?, date_synced = null, date_acknowledged = null WHERE person_id = ?";
		db.run(sql, [datetime, person_id], function (err, result) {
			if (err){
			    res.status(400).json({"error": err.message})
			    return;
			}
			
			formatMessages();        
	            }					
		)
	}	

      });
    
    
    res.json(true)    
});



app.use(function(req, res){
    res.status(404);
});

interval = setInterval(function(){
	if (!processingSMS){
		checkInbox();
	}
}, (settings.check_inbox_interval*1000));
	
	

