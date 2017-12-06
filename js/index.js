/*
  Code proposé par Laurent Millan - Genesys
*/
const platformClient = require('platformClient');

//Credentials
const CLIENTID = '';
const REDIRECTURI = window.location.href;
const ENVIRONMENT = 'mypurecloud.ie'

var PureCloud = platformClient.ApiClient.instance;
PureCloud.setEnvironment('mypurecloud.ie');

const Routing = new platformClient.RoutingApi();
const Users = new platformClient.UsersApi();
const Analytics = new platformClient.AnalyticsApi();
const Conversations = new platformClient.ConversationsApi();
const Notifications = new platformClient.NotificationsApi();

moment.locale("fr");

var decodeHtmlEntities = function(str){
  return str.replace(/&#(\d+);/g, function(match, dec) {
    return String.fromCharCode(dec);
  });
}

const app = new Vue({
  el: '#app',
  data () {
    return {
      me: {},
      myQueues: [],
      selectedQueue: null,
      conversations: [],
      selectedConversation: null,
      conversationMessages: [],
      selectedMessageId: 0,
      notificationsSocket: null
    }
  },
  computed: {
  },
  methods: {
    selectQueue(queue){
      this.selectedQueue = queue;
      this.selectedConversation = null;
    },
    getConversationsForSelectedQueue(){
      const opts = {
       "interval": moment().subtract(1, 'day').toISOString() + "/" + moment().toISOString(),
       "order": "asc",
       "orderBy": "conversationStart",
       "paging": {"pageSize": 25, "pageNumber": 1},
       "segmentFilters": [{
         "type": "or",
         "clauses": [{
           "type": "and",
           "predicates": [{
               "type": "dimension",
               "dimension": "queueId",
               "operator": "matches",
               "value": this.selectedQueue.id
             },
             {
               "type": "dimension",
               "dimension": "segmentEnd",
               "operator": "notExists",
               "value": null
             }]
          }]
        }],
       "conversationFilters": [{
         "type": "or",
         "predicates": [{
           "type": "dimension",
           "dimension": "conversationEnd",
           "operator": "notExists",
           "value": null
          }]
        }]
      }
      return Analytics.postAnalyticsConversationsDetailsQuery(opts).then( convs => {
        this.conversations = convs.conversations;
        return this.conversations;
      })
    },
    getExternalParticipant(conv){
      return conv.participants.find(participant => {
        return participant.purpose.match(/(?:external|customer)/gi) != null;
      })
    },
    getLastACDParticipant(conv){
      let acdParticipants = conv.participants.filter(participant => {
        return participant.purpose.match(/(?:acd)/gi) != null;
      })
      return acdParticipants[acdParticipants.length-1];
    },
    getSessionDetails(conv){
      return this.getExternalParticipant(conv).sessions[0];
    },
    getSegmentDetails(conv){
      return this.getSessionDetails(conv).segments.find(seg => {
        return seg.segmentType == "interact"
      });
    },
    getSegmentStart(conv){
      return this.getSegmentDetails(conv).segmentStart
    },
    getTimeFromNow(time, more){
      return moment(time).fromNow(more)
    },
    selectMessage(msg){
      if(this.selectedMessageId == msg.id){
        this.selectedMessageId = 0;
      }else {
        this.selectedMessageId = msg.id;
      }
    },
    selectConversation(conv){
      //this.selectedConversation = conv;
      if(!this.selectedConversation){
        this.selectedConversation = conv;
      }else{
        if(this.selectedConversation.conversationId == conv.conversationId){
          this.selectedConversation = null;
        }else {
          this.selectedConversation = conv;
        }
      }
    },
    isConversationSelected(conv){
      if(this.selectedConversation)
       return conv.conversationId == this.selectedConversation.conversationId
     else
      return false;
    },
    transferToQueue(queue){
      let transferRequest = {
         "queueId": queue.id
      }

      Conversations.postConversationsEmailParticipantReplace(this.selectedConversation.conversationId, this.getLastACDParticipant(this.selectedConversation).participantId, transferRequest)
      .then( res => {
        console.log("INTERACTION TRANSFEREE");
        this.selectedConversation = null;
        this.getConversationsForSelectedQueue();
      })
    },
    onMessage(message) {
      var data = JSON.parse(message.data);
      console.log(data);
      this.getConversationsForSelectedQueue();
    }
  },
  watch: {
    selectedQueue(){
      this.getConversationsForSelectedQueue()

      /*
      let selectedQueue = this.selectedQueue;
      let self = this;
      Notifications.postNotificationsChannels().then( channel => {
        this.notificationsSocket = new WebSocket(channel.connectUri);
        this.notificationsSocket.onopen = function(){
          let subscriptions = [{
            "id": `v2.routing.queues.${selectedQueue.id}.conversations.emails`
          }]
          Notifications.postNotificationsChannelSubscriptions(channel.id, subscriptions)
        }

        // Message received callback function
        this.notificationsSocket.onmessage = this.onMessage
      })
      */
    },
    selectedConversation(val){
      if(val == null){ return; }

      Conversations.getConversationsEmailMessages(val.conversationId).then(messages => {
        messages.entities;
        let getMessageDetailsPromises = messages.entities.map(msg => {
          return Conversations.getConversationsEmailMessage(val.conversationId, msg.id).then( msg => {
            let matches = msg.htmlBody.match(/src=\"cid:([^"]*)\"/gi);
            let imgMap = matches.map( img => {
              let imgSrcRef = img.replace("src=\"cid:", "").replace("\"", "");
              let decodedImgId = decodeHtmlEntities(imgSrcRef);
              return {
                initial: "cid:" + imgSrcRef,
                parsed: msg.attachments.find( att => {
                  return att.attachmentId == decodedImgId
                }).contentUri
              }
            })

            let newHtmlBody = msg.htmlBody;
            imgMap.forEach( img => {
              newHtmlBody = newHtmlBody.replace(img.initial, img.parsed);
            })
            msg.htmlBody = newHtmlBody;
            return msg;
          })
        })

        Promise.all(getMessageDetailsPromises).then(detailedMessages => {
          this.conversationMessages = detailedMessages;
        })
      })
    }
  },
  created () {
  },
  mounted (){
    // Authenticate
    PureCloud.loginImplicitGrant(CLIENTID, REDIRECTURI)
    .then(login => {
      return Users.getUsersMe({ 'expand': ["presence"] }).then(me => {
        return this.me = me;
      });
    })
    .then( me => {
      // Handle successful result
      console.log(`Hello, ${this.me.name}!`);
      return Users.getUserQueues(this.me.id, { pageSize: 100, pageNumber: 1 }).then( queues => {
        return this.myQueues = queues.entities;
      })
    })
    .then( queues => {
      console.log(this.myQueues);
      setInterval( nothing => {
        this.getConversationsForSelectedQueue()
      }, 5000);
    })
    .catch(function(response) {
      // Handle failure response
      console.log(`${response.status} - ${response.error.message}`);
      console.log(response.error);
    });
  }
})
